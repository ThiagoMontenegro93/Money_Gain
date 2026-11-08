// Opções por empréstimo: padrão geral (amortização / multa diária), novo empréstimo herda, gestor perdoa a multa.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2] || '.';
const step = (m) => console.log('✓ ' + m);

(async () => {
  const browser = await chromium.launch();
  const token = (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'thiago@lendcontrol.app', password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
  const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const get = (p) => fetch(API + p, { headers: H }).then((r) => r.json());
  const original = await get('/loans/settings');
  let waived = null;
  try {
    const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
    const checked = async (p, id) => (await tid(p, id).getAttribute('aria-checked')) === 'true';
    const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT') await l.fill(v); else await l.locator('input').first().fill(v); };
    const login = async (p, email) => { await p.goto(BASE + '/login'); await fill(p, 'login-email', email); await fill(p, 'login-password', 'Lend@2026'); await tid(p, 'login-submit').click(); await p.waitForURL((u) => !u.pathname.includes('login')); };
    const errors = [];

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const d = await ctx.newPage();
    d.on('pageerror', (e) => errors.push(String(e)));
    await login(d, 'thiago@lendcontrol.app');

    // ---------- padrão geral ----------
    await d.goto(BASE + '/settings?tab=emprestimos');
    await tid(d, 'loan-defaults-card').waitFor();
    if (await checked(d, 'def-late-fee')) await tid(d, 'def-late-fee').click();
    if (await checked(d, 'def-amortization')) await tid(d, 'def-amortization').click();
    await tid(d, 'def-save').click();
    await d.waitForTimeout(1000);
    const saved = await get('/loans/settings');
    if (saved.allowLateFee || saved.allowAmortization) throw new Error('padrão não salvo: ' + JSON.stringify(saved));
    await d.screenshot({ path: `${OUT}/opcoes-01-padrao.png` });
    step('Dono definiu o padrão: sem multa diária e sem amortização');

    // ---------- novo empréstimo herda ----------
    const bom = (await get('/clients?classificacao=BOM')).items[0];
    await d.goto(BASE + `/loans/new?clientId=${bom.id}`);
    await tid(d, 'step1-next').waitFor();
    await d.waitForTimeout(800);
    await tid(d, 'step1-next').click();
    await tid(d, 'loan-options').waitFor();
    if (await checked(d, 'opt-late-fee') || await checked(d, 'opt-amortization')) throw new Error('novo empréstimo não herdou o padrão');
    if (await tid(d, 'fine').count()) throw new Error('campo de multa deveria sumir quando não cobra multa');
    await tid(d, 'opt-late-fee').click();
    await tid(d, 'fine').waitFor();
    await d.screenshot({ path: `${OUT}/opcoes-02-novo-emprestimo.png` });
    step('Novo empréstimo vem sem multa e sem amortização; ligar a multa mostra o campo da % diária');

    // ---------- empréstimo sem amortização: opção some do recibo ----------
    await fetch(API + '/loans/settings', { method: 'PUT', headers: H, body: JSON.stringify(original) });
    const loans = await get('/loans?status=ATIVO');
    const pend = new Set((await get('/payments?status=AGUARDANDO_APROVACAO')).map((p) => p.loanId));
    const late = loans.find((l) => l.overdueCount > 0 && l.allowLateFee && l.multaDiaPercent > 0 && !pend.has(l.id));
    if (!late) throw new Error('nenhum empréstimo atrasado com multa no seed');
    await d.goto(BASE + `/loans/${late.id}`);
    await tid(d, 'loan-options-admin').waitFor();
    await tid(d, 'opt-amortization').click();
    await d.waitForTimeout(1200);
    await tid(d, 'launch-receipt').click();
    await tid(d, 'ptype-QUITACAO').waitFor();
    if (await tid(d, 'ptype-AMORTIZACAO').count()) throw new Error('AMORTIZAÇÃO deveria sumir do recibo');
    await d.keyboard.press('Escape');
    await d.goto(BASE + `/loans/${late.id}`);
    await tid(d, 'loan-options-admin').waitFor();
    step('Empréstimo sem amortização: o recibo só oferece juros/parcela e quitação');

    // ---------- gestor perdoa a multa ----------
    const before = await get(`/loans/${late.id}`);
    await tid(d, 'opt-late-fee').click();
    waived = late.id;
    await d.waitForTimeout(1500);
    const after = await get(`/loans/${late.id}`);
    if (after.allowLateFee || after.payoffCents >= before.payoffCents) throw new Error('multa não foi perdoada');
    await d.screenshot({ path: `${OUT}/opcoes-03-multa-perdoada.png`, fullPage: true });
    step(`Multa perdoada no empréstimo #${late.code}: quitação caiu de R$ ${(before.payoffCents / 100).toFixed(2)} para R$ ${(after.payoffCents / 100).toFixed(2)}`);

    // celular
    const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
    await login(m, 'thiago@lendcontrol.app');
    await m.goto(BASE + '/settings?tab=emprestimos');
    await tid(m, 'loan-defaults-card').waitFor();
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(`estouro horizontal de ${over}px no celular`);
    step('Tela no celular sem rolagem horizontal');
    if (errors.length) throw new Error(errors.join(' | '));
    console.log('OPÇÕES OK');
  } catch (e) {
    console.error('✗ FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await fetch(API + '/loans/settings', { method: 'PUT', headers: H, body: JSON.stringify(original) });
    if (waived) await fetch(API + `/loans/${waived}/options`, { method: 'PATCH', headers: H, body: JSON.stringify({ allowLateFee: true, allowAmortization: true }) });
    await browser.close();
  }
})();
