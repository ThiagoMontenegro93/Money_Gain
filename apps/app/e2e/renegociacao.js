// Negociação emergencial + simulação "e se?" sem gravar.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2] || '.';
const step = (m) => console.log('✓ ' + m);
const iso = (d) => new Date(Date.now() + d * 864e5 - 3 * 36e5).toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch();
  const token = (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'thiago@lendcontrol.app', password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
  const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const get = (p) => fetch(API + p, { headers: H }).then((r) => r.json());
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
  try {
    const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
    const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT' || tag === 'TEXTAREA') await l.fill(v); else await l.locator('input,textarea').first().fill(v); };
    const login = async (p, email) => { await p.goto(BASE + '/login'); await fill(p, 'login-email', email); await fill(p, 'login-password', 'Lend@2026'); await tid(p, 'login-submit').click(); await p.waitForURL((u) => !u.pathname.includes('login')); };
    const errors = [];

    // cliente devendo: R$ 20 mil liberados há ~95 dias, sem pagar
    const bom = (await get('/clients?classificacao=BOM')).items[0];
    const loan = await post('/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 2_000_000, ratePercent: 10, releaseDate: iso(-95), allowLateFee: true, multaDiaPercent: 1, longLateMode: 'OFF', notes: 'teste e2e negociação' });
    if (!loan.id) throw new Error('não criou empréstimo: ' + JSON.stringify(loan));

    const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
    d.on('pageerror', (e) => errors.push(String(e)));
    await login(d, 'thiago@lendcontrol.app');
    await d.goto(BASE + `/loans/${loan.id}`);
    await tid(d, 'open-simulation').waitFor();

    // ---------- simulação ----------
    await tid(d, 'open-simulation').click();
    await tid(d, 'sim-modal').waitFor();
    await fill(d, 'sim-fine', '2');
    await tid(d, 'sim-ll-on').click();
    await tid(d, 'sim-ll-mode-FIXED').click();
    await fill(d, 'sim-ll-fixed', '1000');
    await tid(d, 'sim-run').click();
    await tid(d, 'sim-result').waitFor();
    await d.screenshot({ path: `${OUT}/reneg-01-simulacao.png` });
    const still = await get(`/loans/${loan.id}`);
    if (still.multaDiaPercent !== 1 || still.longLateMode !== 'OFF' || still.payoffCents !== loan.payoffCents) throw new Error('simulação gravou no empréstimo');
    await d.keyboard.press('Escape');
    await d.goto(BASE + `/loans/${loan.id}`);
    await tid(d, 'open-reneg').waitFor();
    step('Simulação mostra o antes e depois (multa 2% + R$ 10/dia) sem gravar nada');

    // ---------- negociação emergencial ----------
    await tid(d, 'open-reneg').click();
    await tid(d, 'reneg-modal').waitFor();
    await fill(d, 'reneg-agreed', '500000');
    await fill(d, 'reneg-count', '10');
    await tid(d, 'reneg-preview').click();
    await tid(d, 'reneg-result').waitFor();
    const wo = await tid(d, 'reneg-writeoff').innerText();
    if (!/15\.000,00/.test(wo)) throw new Error('prejuízo errado: ' + wo);
    await fill(d, 'reneg-reason', 'Perdeu o emprego, propôs 5 mil em 10x');
    await d.screenshot({ path: `${OUT}/reneg-02-acordo.png` });
    await tid(d, 'reneg-confirm').click();
    await fill(d, 'prompt-password', 'Lend@2026');
    await tid(d, 'prompt-confirm').click();
    await d.waitForURL((u) => u.pathname.includes('/loans/') && !u.pathname.endsWith(loan.id), { timeout: 15000 });
    await tid(d, 'reneg-from').waitFor();
    await d.screenshot({ path: `${OUT}/reneg-03-novo-acordo.png`, fullPage: true });
    const old = await get(`/loans/${loan.id}`);
    if (old.status !== 'RENEGOCIADO') throw new Error('empréstimo antigo não ficou RENEGOCIADO');
    const novo = await get(`/loans/${old.renegotiatedTo.newLoanId}`);
    if (novo.installments.length !== 10 || novo.installments[0].originalCents !== 50_000) throw new Error('acordo errado');
    step(`Acordo fechado: dívida de R$ ${(old.renegotiatedTo.debtCents / 100).toFixed(2)} virou 10x de R$ 500,00 (empréstimo #${novo.code}); prejuízo de R$ 15.000,00 no caixa`);
    await d.goto(BASE + `/loans/${loan.id}`);
    await tid(d, 'reneg-to').waitFor();
    if (await tid(d, 'open-reneg').count()) throw new Error('dívida renegociada não deveria permitir nova negociação');
    await d.goto(BASE + '/');
    await tid(d, 'stat-reneg').waitFor();
    await tid(d, 'stat-reneg').scrollIntoViewIfNeeded();
    await d.screenshot({ path: `${OUT}/reneg-04-painel.png` });
    step('Dívida antiga mostra o acordo; painel conta as renegociações do mês');

    // ---------- celular ----------
    const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
    m.on('pageerror', (e) => errors.push(String(e)));
    await login(m, 'thiago@lendcontrol.app');
    for (const path of [`/loans/${novo.id}`, `/loans/${loan.id}`, '/loans?status=RENEGOCIADO', '/']) {
      await m.goto(BASE + path);
      await m.waitForTimeout(1500);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) throw new Error(`estouro horizontal de ${over}px no celular em ${path}`);
    }
    await m.goto(BASE + `/loans/${novo.id}`);
    await tid(m, 'open-reneg').waitFor();
    await tid(m, 'open-reneg').click();
    await tid(m, 'reneg-modal').waitFor();
    await fill(m, 'reneg-agreed', '300000');
    await tid(m, 'reneg-preview').click();
    await tid(m, 'reneg-result').waitFor();
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(`estouro horizontal de ${over}px no modal de negociação`);
    await m.screenshot({ path: `${OUT}/reneg-05-celular.png` });
    await m.keyboard.press('Escape');
    await m.goto(BASE + `/loans/${novo.id}`);
    await tid(m, 'open-simulation').click();
    await tid(m, 'sim-run').click();
    await tid(m, 'sim-result').waitFor();
    const over2 = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over2 > 1) throw new Error(`estouro horizontal de ${over2}px na simulação`);
    await m.screenshot({ path: `${OUT}/reneg-06-simulacao-celular.png` });
    step('Celular: negociação e simulação sem rolagem horizontal');
    if (errors.length) throw new Error(errors.join(' | '));
    console.log('RENEGOCIAÇÃO OK');
  } catch (e) {
    console.error('✗ FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
