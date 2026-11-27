// Modo offline ampliado: o app baixa a carteira sozinho depois do login; sem internet o funcionário
// busca e abre um cliente que nunca abriu, lança um empréstimo novo (parcelas calculadas no aparelho)
// e, quando a internet volta, o empréstimo sobe sozinho para o servidor.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2];
const step = (m) => console.log('✓ ' + m);
const cpfGen = () => { const d = String(Date.now()).slice(-9).split('').map(Number); const c = (l) => { let s = 0; for (let i = 0; i < l; i++) s += d[i] * (l + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; d.push(c(9)); d.push(c(10)); return d.join(''); };

(async () => {
  const browser = await chromium.launch();
  const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
  const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT' || tag === 'TEXTAREA') await l.fill(v); else await l.locator('input,textarea').first().fill(v); };
  const apiLogin = async (email) => (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
  const owner = { authorization: 'Bearer ' + (await apiLogin('thiago@lendcontrol.app')), 'content-type': 'application/json' };
  const carlos = { authorization: 'Bearer ' + (await apiLogin('carlos@lendcontrol.app')), 'content-type': 'application/json' };
  const api = async (h, method, path, body) => {
    const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const b = await r.json();
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(b)}`);
    return b;
  };
  const errors = [];

  const marker = `CART${Date.now().toString().slice(-6)}`;
  const client = await api(carlos, 'POST', '/clients', { form: {
    fullName: `Cliente Carteira ${marker}`, cpf: cpfGen(), birthDate: '1988-07-20', whatsapp: '(21) 98111-2233',
    cep: '20745-000', street: 'Rua A', number: '5', district: 'Centro', city: 'Niterói', state: 'RJ',
    pixKey: 'carteira@email.com', pixType: 'EMAIL', emergencyName: 'José', emergencyRelation: 'PAI', emergencyPhone1: '(21) 97777-1111',
    hasGuarantor: false, lgpdConsent: true,
  } });
  const me = await api(carlos, 'GET', '/auth/me');
  await api(owner, 'POST', '/transfers', { type: 'REPASSE_CAPITAL', toUserId: me.id, valueCents: 300000, notes: 'e2e offline carteira' });
  step(`Dados: cliente novo ${client.fullName} (o celular nunca abriu a ficha)`);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errors.push(String(e)));
  m.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  m.on('dialog', (d) => d.dismiss());
  await m.goto(BASE + '/login');
  await fill(m, 'login-email', 'carlos@lendcontrol.app');
  await fill(m, 'login-password', 'Lend@2026');
  await tid(m, 'login-submit').click();
  await m.waitForURL((u) => !u.pathname.includes('login'));
  await m.goto(BASE + '/settings');
  await tid(m, 'offline-data-status').getByText('guardados no aparelho').waitFor({ timeout: 30000 });
  await tid(m, 'offline-data-card').scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${OUT}/carteira-01-baixada.png` });
  step('Depois do login o app baixou a carteira sozinho (Configurações > Uso sem internet)');

  // ---------- Sem internet ----------
  await ctx.setOffline(true);
  await tid(m, 'tab-/clients').click();
  await fill(m, 'client-search', marker);
  await m.getByText(client.fullName).first().waitFor({ timeout: 10000 });
  await m.screenshot({ path: `${OUT}/carteira-02-busca-offline.png` });
  step('Sem internet: a busca por nome funciona com os dados do aparelho');
  await m.getByText(client.fullName).first().click();
  await tid(m, 'client-band').waitFor({ timeout: 10000 });
  await tid(m, 'offline-banner').waitFor();
  step('Abriu a ficha de um cliente que nunca tinha sido aberto neste aparelho');

  await m.getByText('Novo', { exact: true }).first().click();
  await m.waitForURL((u) => u.pathname.includes('/loans/new'));
  await m.getByText(client.fullName).first().waitFor({ timeout: 10000 });
  await tid(m, 'step1-next').click();
  await fill(m, 'principal', '50000'); // R$ 500,00
  await fill(m, 'rate', '10');
  await tid(m, 'step2-next').click();
  await tid(m, 'loan-offline-notice').waitFor({ timeout: 10000 });
  await m.getByText('Juros previstos').first().waitFor();
  await m.screenshot({ path: `${OUT}/carteira-03-revisao-offline.png`, fullPage: true });
  step('Revisão do empréstimo sem internet: parcelas calculadas no próprio aparelho');
  await tid(m, 'create-loan').click();
  await m.getByText('Salvo no aparelho — será enviado quando a internet voltar').first().waitFor({ timeout: 10000 });
  await tid(m, 'queued-loan').waitFor({ timeout: 10000 });
  await m.screenshot({ path: `${OUT}/carteira-04-emprestimo-na-fila.png` });
  const before = await api(owner, 'GET', `/loans?clientId=${client.id}`);
  if (before.length !== 0) throw new Error('nada deveria chegar ao servidor offline');
  step('Empréstimo novo salvo no aparelho e mostrado na ficha como "aguardando envio"');

  // ---------- Internet volta ----------
  await ctx.setOffline(false);
  const end = Date.now() + 30000;
  let after = [];
  while (Date.now() < end) {
    after = await api(owner, 'GET', `/loans?clientId=${client.id}`);
    if (after.length) break;
    await m.waitForTimeout(500);
  }
  if (after.length !== 1) throw new Error('empréstimo não subiu: ' + after.length);
  if (after[0].principalCents !== 50000) throw new Error('valor errado: ' + after[0].principalCents);
  await tid(m, 'queued-loan').waitFor({ state: 'detached', timeout: 15000 });
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${OUT}/carteira-05-sincronizado.png` });
  step(`Internet voltou: o empréstimo #${after[0].code} subiu sozinho para o servidor (uma vez só)`);

  await browser.close();
  if (errors.length) { console.log('ERROS:', errors); process.exit(1); }
  console.log('\nOFFLINE CARTEIRA OK');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
