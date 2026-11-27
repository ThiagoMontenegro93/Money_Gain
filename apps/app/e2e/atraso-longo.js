// Cobrança especial por atraso longo: padrão geral, novo empréstimo, gestor liga no empréstimo atrasado, painel mostra o ganho.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2] || '.';
const step = (m) => console.log('✓ ' + m);

(async () => {
  const browser = await chromium.launch();
  const token = (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'thiago@lendcontrol.app', password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
  const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const get = (p) => fetch(API + p, { headers: H }).then((r) => r.json());
  const original = await get('/loans/settings');
  let touched = null;
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

    // ---------- padrão geral: R$ 15 por dia a partir de 60 dias ----------
    await d.goto(BASE + '/settings?tab=emprestimos');
    await tid(d, 'loan-defaults-card').waitFor();
    if (!(await checked(d, 'def-ll-on'))) await tid(d, 'def-ll-on').click();
    await tid(d, 'def-ll-mode-FIXED').click();
    await fill(d, 'def-ll-days', '60');
    await fill(d, 'def-ll-fixed', '1500');
    await tid(d, 'def-save').click();
    await d.waitForTimeout(1000);
    const saved = await get('/loans/settings');
    if (saved.longLateMode !== 'FIXED' || saved.longLateFixedCents !== 1500 || saved.longLateAfterDays !== 60) throw new Error('padrão não salvo: ' + JSON.stringify(saved));
    await d.screenshot({ path: `${OUT}/atraso-longo-01-padrao.png` });
    step('Dono ligou o padrão: R$ 15,00 por dia a partir de 60 dias de atraso');

    // ---------- novo empréstimo herda ----------
    const bom = (await get('/clients?classificacao=BOM')).items[0];
    await d.goto(BASE + `/loans/new?clientId=${bom.id}`);
    await tid(d, 'step1-next').waitFor();
    await d.waitForTimeout(800);
    await tid(d, 'step1-next').click();
    await tid(d, 'loan-options').waitFor();
    if (!(await checked(d, 'opt-ll-on'))) throw new Error('novo empréstimo não herdou o atraso longo');
    const fixedVal = await tid(d, 'opt-ll-fixed').locator('input').first().inputValue().catch(() => tid(d, 'opt-ll-fixed').inputValue());
    if (!/15,00/.test(fixedVal)) throw new Error('valor fixo não veio do padrão: ' + fixedVal);
    await tid(d, 'opt-ll-mode-PERCENT').click();
    await tid(d, 'opt-ll-percent').waitFor();
    await tid(d, 'loan-options').scrollIntoViewIfNeeded();
    await d.screenshot({ path: `${OUT}/atraso-longo-02-novo-emprestimo.png` });
    step('Novo empréstimo já vem com o atraso longo ligado; dá para trocar para % ao dia');

    // ---------- gestor liga no empréstimo atrasado (limite baixo para o seed) ----------
    await fetch(API + '/loans/settings', { method: 'PUT', headers: H, body: JSON.stringify(original) });
    const loans = await get('/loans?status=ATIVO');
    const pend = new Set((await get('/payments?status=AGUARDANDO_APROVACAO')).map((p) => p.loanId));
    const late = loans.find((l) => l.overdueCount > 0 && l.longLateMode === 'OFF' && !pend.has(l.id));
    if (!late) throw new Error('nenhum empréstimo atrasado no seed');
    const before = await get(`/loans/${late.id}`);
    const dias = Math.max(...before.installments.map((i) => i.diasAtraso));
    touched = { id: late.id, longLateMode: before.longLateMode, longLateAfterDays: before.longLateAfterDays, longLatePercent: before.longLatePercent, longLateFixedCents: before.longLateFixedCents };
    await d.goto(BASE + `/loans/${late.id}`);
    await tid(d, 'loan-options-admin').waitFor();
    await tid(d, 'loan-ll-on').click();
    await tid(d, 'loan-ll-mode-FIXED').click();
    await fill(d, 'loan-ll-days', '1');
    await fill(d, 'loan-ll-fixed', '1000');
    await tid(d, 'loan-ll-save').click();
    await tid(d, 'quote-long-late').waitFor();
    const after = await get(`/loans/${late.id}`);
    if (after.longLateMode !== 'FIXED' || !(after.payoffCents > before.payoffCents)) throw new Error('atraso longo não aplicado');
    const extra = after.quote.payoff.longLateCents;
    if (extra < dias * 1000) throw new Error(`atraso longo menor que o esperado: ${extra}`);
    await d.screenshot({ path: `${OUT}/atraso-longo-03-emprestimo.png`, fullPage: true });
    step(`Empréstimo #${late.code} (${dias} dias de atraso): quitação subiu de R$ ${(before.payoffCents / 100).toFixed(2)} para R$ ${(after.payoffCents / 100).toFixed(2)}`);

    // ---------- painel ----------
    await d.goto(BASE + '/');
    await tid(d, 'stat-atraso-longo').waitFor();
    const txt = await tid(d, 'stat-atraso-longo').innerText();
    if (/R\$ 0,00/.test(txt)) throw new Error('painel não mostra o atraso longo acumulado: ' + txt);
    await tid(d, 'stat-atraso-longo').scrollIntoViewIfNeeded();
    await d.screenshot({ path: `${OUT}/atraso-longo-04-painel.png` });
    step('Painel mostra o atraso longo acumulado e as multas recebidas no mês');

    // celular
    const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
    m.on('pageerror', (e) => errors.push(String(e)));
    await login(m, 'thiago@lendcontrol.app');
    for (const path of ['/settings?tab=emprestimos', `/loans/${late.id}`, '/']) {
      await m.goto(BASE + path);
      await m.waitForTimeout(1500);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) throw new Error(`estouro horizontal de ${over}px no celular em ${path}`);
    }
    await m.goto(BASE + '/settings?tab=emprestimos');
    await tid(m, 'loan-defaults-card').waitFor();
    if (!(await checked(m, 'def-ll-on'))) await tid(m, 'def-ll-on').click();
    await m.screenshot({ path: `${OUT}/atraso-longo-05-celular.png`, fullPage: true });
    step('Telas no celular sem rolagem horizontal');
    if (errors.length) throw new Error(errors.join(' | '));
    console.log('ATRASO LONGO OK');
  } catch (e) {
    console.error('✗ FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await fetch(API + '/loans/settings', { method: 'PUT', headers: H, body: JSON.stringify(original) });
    if (touched) { const { id, ...rest } = touched; await fetch(API + `/loans/${id}/options`, { method: 'PATCH', headers: H, body: JSON.stringify(rest) }); }
    await browser.close();
  }
})();
