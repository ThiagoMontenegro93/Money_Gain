// Fase 4 (offline-first): funcionário no celular perde a internet, continua vendo os dados do cache,
// lança recibo JUROS com foto do comprovante e tentativa de cobrança; ao voltar a conexão a fila
// sincroniza sozinha, sem duplicar nada mesmo com reenvio forçado; o dono aprova no desktop.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2];
const step = (m) => console.log('✓ ' + m);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const cpfGen = () => { const d = String(Date.now()).slice(-9).split('').map(Number); const c = (l) => { let s = 0; for (let i = 0; i < l; i++) s += d[i] * (l + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; d.push(c(9)); d.push(c(10)); return d.join(''); };

(async () => {
  const browser = await chromium.launch();
  const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
  const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT' || tag === 'TEXTAREA') await l.fill(v); else await l.locator('input,textarea').first().fill(v); };
  const login = async (p, email) => { await p.goto(BASE + '/login'); await fill(p, 'login-email', email); await fill(p, 'login-password', 'Lend@2026'); await tid(p, 'login-submit').click(); await p.waitForURL((u) => !u.pathname.includes('login')); };
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
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    p.on('dialog', (d) => d.dismiss());
  };

  // ---------- Dados: cliente do Carlos com empréstimo só-juros vencido ----------
  const marker = `OFF-${Date.now().toString().slice(-6)}`;
  const client = await api(carlos, 'POST', '/clients', { form: {
    fullName: `Cliente Offline ${marker}`, cpf: cpfGen(), birthDate: '1990-03-15', whatsapp: '(21) 99123-4567',
    cep: '20745-000', street: 'Rua das Flores', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ',
    pixKey: 'offline@email.com', pixType: 'EMAIL', emergencyName: 'Maria', emergencyRelation: 'MAE', emergencyPhone1: '(21) 97777-7777',
    hasGuarantor: false, lgpdConsent: true,
  } });
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  const release = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let loan;
  try {
    loan = await api(carlos, 'POST', '/loans', { clientId: client.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100000, ratePercent: 10, multaDiaPercent: 1, releaseDate: release, riskAcknowledged: true });
  } catch (e) {
    if (!String(e.message).includes('INSUFFICIENT_CAPITAL')) throw e;
    // carteira do Carlos sem saldo neste banco: o dono repassa capital e tenta de novo
    const me = await api(carlos, 'GET', '/auth/me');
    await api(owner, 'POST', '/transfers', { type: 'REPASSE_CAPITAL', toUserId: me.id, valueCents: 200000, notes: 'e2e offline' });
    loan = await api(carlos, 'POST', '/loans', { clientId: client.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100000, ratePercent: 10, multaDiaPercent: 1, releaseDate: release, riskAcknowledged: true });
  }
  const juros = (await api(carlos, 'GET', `/loans/${loan.id}`)).quote.interestOnlyCents;
  step(`Dados: cliente ${client.fullName} e empréstimo #${loan.code} (juros devidos ${juros / 100})`);

  // ---------- Funcionário no celular (390px) com cache aquecido ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const m = await mctx.newPage();
  watch(m);
  await login(m, 'carlos@lendcontrol.app');
  step('Carlos fez login no celular');
  await m.goto(`${BASE}/clients/${client.id}`);
  await tid(m, 'client-band').waitFor();
  await m.goto(`${BASE}/loans/${loan.id}`);
  await tid(m, 'installment-timeline').waitFor();
  await m.waitForTimeout(500);
  step('Abriu o cliente e o empréstimo com internet (cache aquecido)');

  // ---------- Sem internet ----------
  await mctx.setOffline(true);
  await m.getByText(`${client.fullName} ›`).first().click();
  await tid(m, 'client-band').waitFor({ timeout: 8000 });
  const banner = await tid(m, 'offline-banner').innerText({ timeout: 8000 });
  if (!/Offline — dados de \d{2}\/\d{2} \d{2}:\d{2}/.test(banner)) throw new Error('aviso offline inesperado: ' + banner);
  await m.screenshot({ path: `${OUT}/offline-01-client-cache.png` });
  step(`Sem internet o cliente abre do cache com o aviso "${banner}"`);

  // tentativa de cobrança offline
  await tid(m, 'tab-2').click();
  await fill(m, 'attempt-result', `Prometeu pagar sexta ${marker}`);
  await tid(m, 'attempt-save').click();
  await m.getByText('Salvo no aparelho — será enviado quando a internet voltar').first().waitFor({ timeout: 8000 });
  await tid(m, 'queued-attempt').waitFor();
  await m.screenshot({ path: `${OUT}/offline-02-attempt-queued.png` });
  step('Tentativa de cobrança salva no aparelho (aparece como "aguardando envio")');

  // volta ao empréstimo (do cache) e lança o recibo JUROS com foto
  await m.goBack();
  await tid(m, 'installment-timeline').waitFor({ timeout: 8000 });
  await tid(m, 'launch-receipt').click();
  await tid(m, 'receipt-modal').waitFor();
  const [chooser] = await Promise.all([m.waitForEvent('filechooser'), tid(m, 'receipt-file').locator('[role=button],button').first().click()]);
  await chooser.setFiles({ name: 'pix-offline.png', mimeType: 'image/png', buffer: PNG });
  await tid(m, 'receipt-file-status').getByText('Guardado no aparelho').waitFor({ timeout: 8000 });
  await fill(m, 'receipt-amount', String(juros)); // máscara de caixa: dígitos = centavos ("10000" = R$ 100,00)
  await m.screenshot({ path: `${OUT}/offline-03-receipt-offline.png` });
  await tid(m, 'receipt-submit').click();
  await tid(m, 'receipt-modal').waitFor({ state: 'hidden', timeout: 8000 });
  await m.getByText('Salvo no aparelho — será enviado quando a internet voltar').first().waitFor({ timeout: 8000 });
  await tid(m, 'queued-receipt').waitFor();
  const pill = await tid(m, 'outbox-pill').innerText();
  if (!pill.includes('⏳ 2 pendentes de envio')) throw new Error('indicador de pendências inesperado: ' + pill);
  await tid(m, 'outbox-pill').click();
  await tid(m, 'outbox-modal').waitFor();
  await tid(m, 'outbox-item-1').waitFor();
  await m.waitForTimeout(600);
  await m.screenshot({ path: `${OUT}/offline-04-outbox.png` });
  await m.locator('[aria-label="Fechar"]').first().click();
  step(`Recibo JUROS com comprovante salvo no aparelho; indicador "${pill.trim()}"`);
  if ((await api(owner, 'GET', `/payments?loanId=${loan.id}`)).length !== 0) throw new Error('nada deveria chegar ao servidor offline');

  // ---------- Internet volta: a 1ª resposta do POST /payments se perde (o servidor grava, o aparelho não sabe) ----------
  let dropped = 0;
  const replays = [];
  await m.route('**/api/payments', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && dropped === 0) {
      dropped++;
      await route.fetch(); // chega ao servidor...
      return route.abort('failed'); // ...mas a resposta não volta ao celular
    }
    return route.continue();
  });
  m.on('response', (r) => { if (r.url().endsWith('/api/payments') && r.request().method() === 'POST') replays.push({ status: r.status(), replayed: r.headers()['idempotent-replayed'] ?? null, key: r.request().headers()['idempotency-key'] }); });
  await mctx.setOffline(false);
  // sincroniza sozinho com o evento "online"; o recibo cai na queda simulada e fica para nova tentativa
  const end1 = Date.now() + 15000;
  while (dropped === 0 && Date.now() < end1) await m.waitForTimeout(200);
  if (!dropped) throw new Error('sincronização automática não começou ao voltar a internet');
  step('Internet voltou: sincronização começou sozinha (1ª resposta do recibo perdida de propósito)');
  const afterDrop = await api(owner, 'GET', `/payments?loanId=${loan.id}`);
  if (afterDrop.length !== 1) throw new Error('o servidor deveria ter gravado o recibo uma vez: ' + afterDrop.length);
  // força o reenvio pelo botão "Sincronizar agora"
  await tid(m, 'outbox-pill').click();
  await tid(m, 'outbox-modal').waitFor();
  await tid(m, 'outbox-sync').click();
  await tid(m, 'outbox-pill').waitFor({ state: 'detached', timeout: 20000 });
  await m.locator('[aria-label="Fechar"]').first().click().catch(() => {});
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${OUT}/offline-05-synced.png` });
  const replay = replays.find((r) => r.status === 201);
  if (!replay || replay.replayed !== 'true') throw new Error('reenvio não foi atendido pela idempotência: ' + JSON.stringify(replays));
  step(`"Sincronizar agora" reenviou com a mesma Idempotency-Key (${replay.key.slice(0, 8)}...) e o servidor devolveu a resposta original`);

  const pays = await api(owner, 'GET', `/payments?loanId=${loan.id}`);
  if (pays.length !== 1 || pays[0].status !== 'AGUARDANDO_APROVACAO' || !pays[0].comprovanteFileId) throw new Error('esperado 1 recibo pendente com comprovante: ' + JSON.stringify(pays.map((p) => [p.status, p.comprovanteFileId])));
  if (pays[0].valueCents !== juros || pays[0].type !== 'JUROS') throw new Error('recibo com valor/tipo errado');
  const cdet = await api(owner, 'GET', `/clients/${client.id}`);
  const atts = cdet.collectionAttempts.filter((a) => a.result.includes(marker));
  if (atts.length !== 1) throw new Error('esperada 1 tentativa de cobrança: ' + atts.length);
  await tid(m, 'installment-timeline').waitFor();
  if (await tid(m, 'offline-banner').count()) throw new Error('aviso offline deveria sumir com a internet de volta');
  step('API: exatamente 1 recibo AGUARDANDO_APROVACAO (com comprovante) e 1 tentativa de cobrança - sem duplicatas');

  // ---------- Dono aprova no desktop ----------
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const dsk = await dctx.newPage();
  watch(dsk);
  await login(dsk, 'thiago@lendcontrol.app');
  await dsk.goto(BASE + '/approvals');
  await tid(dsk, `approve-${pays[0].id}`).click();
  await fill(dsk, 'prompt-password', 'Lend@2026');
  await tid(dsk, 'prompt-confirm').click();
  await dsk.waitForTimeout(2000);
  const approved = (await api(owner, 'GET', `/payments?loanId=${loan.id}`))[0];
  if (approved.status === 'AGUARDANDO_APROVACAO' || approved.status === 'REJEITADO') throw new Error('recibo não foi aprovado: ' + approved.status);
  await dsk.goto(`${BASE}/loans/${loan.id}`);
  await tid(dsk, 'installment-timeline').waitFor();
  await dsk.screenshot({ path: `${OUT}/offline-06-approved.png`, fullPage: true });
  step(`Dono aprovou no desktop com senha (status ${approved.status}) - só agora a parcela foi baixada`);

  await browser.close();
  if (errors.length) { console.log('ERROS:', errors); process.exit(1); }
  console.log('\nOFFLINE OK');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
