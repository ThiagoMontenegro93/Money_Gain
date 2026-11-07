// Fluxo Fase 3: e-mail do backup, gerar/baixar backup, exportar criptografado, validar e restaurar pela tela.
// Requer a API em http://localhost:3000 com SMTP_URL=smtp://localhost:2526 (servidor SMTP de teste sobe aqui).
const { chromium } = require('playwright');
const { SMTPServer } = require('smtp-server');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2] || '.';
const step = (m) => console.log('✓ ' + m);

(async () => {
  const mails = [];
  const smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'], logger: false,
    onData(stream, session, cb) { let raw = ''; stream.on('data', (c) => (raw += c)); stream.on('end', () => { mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); }); },
  });
  await new Promise((r) => smtp.listen(2526, r));
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lc-e2e-'));
  try {
    const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
    const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT' || tag === 'TEXTAREA') await l.fill(v); else await l.locator('input,textarea').first().fill(v); };
    const login = async (p, email) => { await p.goto(BASE + '/login'); await fill(p, 'login-email', email); await fill(p, 'login-password', 'Lend@2026'); await tid(p, 'login-submit').click(); await p.waitForURL((u) => !u.pathname.includes('login')); };
    const token = (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'thiago@lendcontrol.app', password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const get = (p) => fetch(API + p, { headers: H }).then((r) => r.json());
    const errors = [];
    const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); }); };
    const originalEmail = await get('/backups/settings');

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
    const d = await ctx.newPage();
    watch(d);
    await login(d, 'thiago@lendcontrol.app');
    await d.goto(BASE + '/settings?tab=backup');
    await tid(d, 'backup-email-card').waitFor();
    step('Dono abriu Configurações > Backup');

    // ---------- e-mail ----------
    await fill(d, 'backup-email', 'email-invalido');
    await tid(d, 'backup-email-save').click();
    await d.getByText('E-mail inválido').first().waitFor();
    await fill(d, 'backup-email', 'thiago.backup@exemplo.com');
    await fill(d, 'backup-extra', 'contador@exemplo.com, socio@exemplo.com');
    if ((await tid(d, 'backup-email-enabled').getAttribute('aria-checked')) !== 'true') await tid(d, 'backup-email-enabled').click();
    await tid(d, 'backup-email-save').click();
    await tid(d, 'backup-email-saved').waitFor();
    const saved = await get('/backups/settings');
    if (!saved.enabled || saved.email !== 'thiago.backup@exemplo.com' || saved.extraEmails.length !== 2) throw new Error('config de e-mail não salva: ' + JSON.stringify(saved));
    step('E-mail do backup salvo ("✅ E-mail de backup salvo") com 2 adicionais e envio automático ativo');
    const before = mails.length;
    await tid(d, 'backup-email-test').click();
    for (let i = 0; i < 40 && mails.length === before; i++) await d.waitForTimeout(250);
    const m = mails.at(-1);
    if (!m || m.to.length !== 3 || !/lendcontrol-backup-.*\.xlsx/.test(m.raw)) throw new Error('e-mail de teste não chegou com o anexo');
    step(`"Testar envio agora" entregou a planilha para ${m.to.join(', ')}`);
    await d.screenshot({ path: `${OUT}/fase3-01-backup-email.png`, fullPage: true });

    // ---------- gerar e baixar ----------
    await tid(d, 'backup-create').click();
    await d.waitForTimeout(1500);
    const list = await get('/backups');
    const latest = list.backups[0];
    await tid(d, `backup-row-${latest.id}`).waitFor();
    const [dl] = await Promise.all([d.waitForEvent('download'), tid(d, `backup-download-${latest.id}`).click()]);
    const xlsxPath = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(xlsxPath);
    const xbuf = fs.readFileSync(xlsxPath);
    if (xbuf.subarray(0, 2).toString() !== 'PK' || !/\.xlsx$/.test(xlsxPath)) throw new Error('download não é .xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    const names = wb.worksheets.map((w) => w.name).filter((n) => !n.startsWith('_'));
    if (names.length !== 7) throw new Error('esperava 7 abas: ' + names);
    step(`Backup gerado e baixado pela tela (${dl.suggestedFilename()}, 7 abas: ${names.join(', ')})`);
    await d.screenshot({ path: `${OUT}/fase3-02-backup-historico.png`, fullPage: true });

    // ---------- criptografado ----------
    await tid(d, `backup-enc-${latest.id}`).click();
    await fill(d, 'backup-enc-pass', 'cofre-2026');
    await fill(d, 'backup-enc-pass2', 'cofre-2026');
    const [edl] = await Promise.all([d.waitForEvent('download'), tid(d, 'backup-enc-confirm').click()]);
    const encPath = path.join(tmp, edl.suggestedFilename());
    await edl.saveAs(encPath);
    if (fs.readFileSync(encPath).subarray(0, 6).toString() !== 'LCBAK1') throw new Error('arquivo criptografado inválido');
    step(`Backup criptografado baixado (${edl.suggestedFilename()})`);

    // ---------- planilha editada com o sistema "fora do ar" ----------
    const loans = await get('/loans?status=ATIVO');
    const pending = new Set((await get('/payments?status=AGUARDANDO_APROVACAO')).map((p) => p.loanId));
    const loan = loans.find((l) => l.type === 'INTEREST_ONLY' && !pending.has(l.id));
    const quote = await get(`/loans/${loan.id}/quote`);
    const pay = wb.getWorksheet('4_PAGAMENTOS');
    let last = 1;
    pay.eachRow((r, n) => { if (r.getCell(10).value) last = n; });
    const row = pay.getRow(last + 1);
    row.getCell(1).value = new Date(); row.getCell(3).value = loan.code; row.getCell(4).value = 'JUROS'; row.getCell(5).value = quote.interestOnlyCents / 100;
    row.commit();
    const editedPath = path.join(tmp, 'backup-editado.xlsx');
    await wb.xlsx.writeFile(editedPath);
    const draft = await fetch(API + '/clients', { method: 'POST', headers: H, body: JSON.stringify({ form: { fullName: 'Cadastro Depois do Backup' }, draft: true }) }).then((r) => r.json());
    step(`Planilha recebeu à mão um pagamento de juros do empréstimo ${loan.code}; e um cadastro novo foi feito depois do backup`);

    // ---------- restaurar: arquivo inválido ----------
    const badPath = path.join(tmp, 'qualquer.xlsx');
    fs.writeFileSync(badPath, 'isto não é excel');
    let [fc] = await Promise.all([d.waitForEvent('filechooser'), tid(d, 'restore-drop').click()]);
    await fc.setFiles(badPath);
    await tid(d, 'restore-validate').click();
    await tid(d, 'restore-errors').waitFor();
    step('Arquivo inválido: "Validar Planilha" mostra o erro e não libera a restauração');

    // ---------- restaurar: criptografado precisa de senha; depois o editado ----------
    [fc] = await Promise.all([d.waitForEvent('filechooser'), tid(d, 'restore-drop').click()]);
    await fc.setFiles(encPath);
    await fill(d, 'restore-file-pass', 'cofre-2026');
    await tid(d, 'restore-validate').click();
    await tid(d, 'restore-summary').waitFor();
    step('Backup criptografado validado com a senha do arquivo');

    [fc] = await Promise.all([d.waitForEvent('filechooser'), tid(d, 'restore-drop').click()]);
    await fc.setFiles(editedPath);
    await tid(d, 'restore-validate').click();
    await tid(d, 'restore-distribution').waitFor();
    const summary = await tid(d, 'restore-summary').innerText();
    if (!/^Planilha de \d{2}\/\d{2}\/\d{4} encontrada - \d+ clientes, \d+ empréstimos, \d+ parcelas - Confere\?$/.test(summary.trim())) throw new Error('prévia inesperada: ' + summary);
    const dist = await tid(d, 'restore-distribution').innerText();
    if (!/clientes -> área Clientes/.test(dist) || !new RegExp(`Empréstimo ${loan.code}`).test(dist)) throw new Error('distribuição inesperada: ' + dist);
    step(`Prévia: "${summary.trim()}"`);
    await d.screenshot({ path: `${OUT}/fase3-03-restauracao-previa.png`, fullPage: true });

    await tid(d, 'restore-now').click();
    await tid(d, 'prompt-password').waitFor();
    await fill(d, 'prompt-password', 'senha-errada');
    await tid(d, 'prompt-confirm').click();
    await d.getByText('Senha incorreta').first().waitFor();
    if (d.url().includes('/login')) throw new Error('senha errada derrubou a sessão');
    await fill(d, 'prompt-password', 'Lend@2026');
    await d.screenshot({ path: `${OUT}/fase3-04-restauracao-confirmar.png` });
    await tid(d, 'prompt-confirm').click();
    await tid(d, 'restore-result').waitFor({ timeout: 60000 });
    const res = await tid(d, 'restore-result').innerText();
    if (!res.includes('✅ Sistema restaurado com sucesso')) throw new Error('resultado: ' + res);
    step('Restaurado com senha do Super Admin: "✅ Sistema restaurado com sucesso"');
    await tid(d, 'restore-log').scrollIntoViewIfNeeded();
    await d.screenshot({ path: `${OUT}/fase3-05-restaurado.png`, fullPage: true });

    const gone = await fetch(API + `/clients/${draft.id}`, { headers: H });
    if (gone.status !== 404) throw new Error('cadastro feito depois do backup deveria ter sumido');
    const pend = (await get('/payments?status=AGUARDANDO_APROVACAO')).find((p) => p.loanId === loan.id);
    if (!pend || pend.valueCents !== quote.interestOnlyCents) throw new Error('pagamento da planilha não virou recibo pendente');
    await d.goto(BASE + '/approvals');
    await d.getByText(pend.clientName).first().waitFor();
    step(`Pagamento lançado na planilha apareceu em Aprovações (${pend.clientName}); cadastro posterior ao backup sumiu`);
    await d.screenshot({ path: `${OUT}/fase3-06-aprovacao-da-planilha.png`, fullPage: true });

    // ---------- celular ----------
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const mp = await mctx.newPage();
    watch(mp);
    await login(mp, 'thiago@lendcontrol.app');
    await mp.goto(BASE + '/settings?tab=backup');
    await tid(mp, 'backup-history').waitFor();
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(`tela de backup estoura ${over}px no celular`);
    await mp.screenshot({ path: `${OUT}/fase3-07-backup-celular.png`, fullPage: true });
    step('Tela de backup no celular sem rolagem horizontal');

    // limpa: recibo de teste rejeitado e e-mail como estava
    await fetch(API + `/payments/${pend.id}/reject`, { method: 'POST', headers: H, body: JSON.stringify({ reason: 'teste e2e' }) });
    await fetch(API + '/backups/settings', { method: 'PUT', headers: H, body: JSON.stringify(originalEmail) });
    if (errors.length) throw new Error('erros na página/API: ' + errors.join(' | '));
    console.log('FLUXO FASE 3 OK');
  } catch (e) {
    console.error('✗ FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    smtp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
