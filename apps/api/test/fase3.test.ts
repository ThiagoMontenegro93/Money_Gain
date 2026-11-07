/**
 * Fase 3: backup semanal em Excel (7 abas + fórmulas BANE), e-mail, exportação criptografada e restauração.
 * Requer API rodando com SMTP_URL=smtp://localhost:2526 (o .env de desenvolvimento já aponta para o servidor de teste abaixo).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { SMTPServer } from 'smtp-server';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'Lend@2026';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const b = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: b as Json, headers: res.headers };
}
const ok = async (t: string, m: string, p: string, b?: unknown) => {
  const r = await call(t, m, p, b);
  if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const preview = async (token: string, buf: Buffer, name: string, filePassword?: string) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  if (filePassword) fd.append('filePassword', filePassword);
  const r = await fetch(`${API}/backups/restore/preview`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, body: (await r.json()) as Json };
};
const load = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
};

let owner: string, carlos: string, gestor: string;
let smtp: SMTPServer;
const mails: { to: string[]; raw: string }[] = [];

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => (raw += c.toString()));
      stream.on('end', () => {
        mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(2526, r));
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  carlos = (await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
  gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
});
afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

let backupId: string;
let xlsx: Buffer;

describe('Backup em Excel (7 abas BANE)', () => {
  it('só o Super Admin acessa backups', async () => {
    expect((await call(carlos, 'GET', '/backups')).status).toBe(403);
    expect((await call(gestor, 'POST', '/backups')).status).toBe(403);
  });

  it('gera planilha com 7 abas, fórmulas em 500 linhas, formatação por score e dados ocultos', async () => {
    const b = await ok(owner, 'POST', '/backups');
    backupId = b.id;
    expect(b.totalClientes).toBeGreaterThanOrEqual(6);
    expect(b.available).toBe(true);
    const dl = await call(owner, 'GET', `/backups/${b.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/lendcontrol-backup-.*\.xlsx/);
    xlsx = dl.body;
    const wb = await load(xlsx);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['1_CLIENTES', '2_EMPRESTIMOS', '3_PARCELAS', '4_PAGAMENTOS', '5_CARTEIRA_FUNCIONARIOS', '6_REPASSES', '7_RESUMO', '_DADOS']);
    expect(wb.getWorksheet('_DADOS')!.state).toBe('veryHidden');

    const cli = wb.getWorksheet('1_CLIENTES')!;
    const rows = [] as { nome: string; cpf: string; status: string }[];
    cli.eachRow((r, n) => n > 1 && r.getCell(1).value && rows.push({ nome: String(r.getCell(1).value), cpf: String(r.getCell(2).value), status: String(r.getCell(5).value) }));
    expect(rows.map((r) => r.status).sort()).toEqual(expect.arrayContaining(['BOM', 'REGULAR', 'RUIM', 'PERDA']));
    expect(rows.find((r) => r.nome.startsWith('Pedro'))!.cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect((cli.getCell('F2').value as Json).formula).toBe('IF(D2="","",IF(D2>=8,"BOM",IF(D2>=5,"REGULAR",IF(D2>=2,"RUIM","PERDA"))))');
    expect((cli.getCell('F501').value as Json).formula).toContain('D501'); // fórmulas prontas em 500 linhas
    const cf = (cli as Json).conditionalFormattings as Json[];
    expect(cf[0].rules.map((r: Json) => r.formulae[0])).toEqual(expect.arrayContaining([expect.stringContaining('"PERDA"'), expect.stringContaining('"BOM"')]));

    const par = wb.getWorksheet('3_PARCELAS')!;
    expect((par.getCell('G2').value as Json).formula).toMatch(/TODAY\(\)-D2/);
    expect((par.getCell('J2').value as Json).formula).toBe('IF(E2="","",E2*(1+F2/100*G2))');
    expect((wb.getWorksheet('2_EMPRESTIMOS')!.getCell('K2').value as Json).formula).toBe('IF(D2="","",D2*(1+E2/100))');
    expect((wb.getWorksheet('5_CARTEIRA_FUNCIONARIOS')!.getCell('J2').value as Json).formula).toBe('IF(A2="","",C2-E2-I2)');
    const res = wb.getWorksheet('7_RESUMO')!;
    const formulas = [] as string[];
    res.eachRow((r) => r.eachCell((c) => (c.value as Json)?.formula && formulas.push((c.value as Json).formula)));
    expect(formulas.join(' ')).toMatch(/EDATE\(\$B\$17,3\)/);
    expect(formulas.join(' ')).toMatch(/SUMIFS\('2_EMPRESTIMOS'!H:H,'2_EMPRESTIMOS'!G:G,"PERDA"\)/);
  });

  it('histórico lista os últimos backups', async () => {
    const l = await ok(owner, 'GET', '/backups');
    expect(l.backups[0].id).toBe(backupId);
    expect(l.backups.length).toBeLessThanOrEqual(10);
    expect(l.smtpConfigured).toBe(true);
  });
});

describe('E-mail do backup', () => {
  it('valida, salva e testa o envio com anexo para o e-mail principal e adicionais', async () => {
    expect((await call(owner, 'PUT', '/backups/settings', { enabled: true, email: 'nao-e-email', extraEmails: [] })).status).toBe(400);
    const saved = await ok(owner, 'PUT', '/backups/settings', { enabled: true, email: 'Thiago@Exemplo.com', extraEmails: ['contador@exemplo.com'] });
    expect(saved.email).toBe('thiago@exemplo.com');
    expect(await ok(owner, 'GET', '/backups/settings')).toMatchObject({ enabled: true, extraEmails: ['contador@exemplo.com'] });
    const sent = await ok(owner, 'POST', '/backups/settings/test');
    expect(sent.emailSentTo).toBe('thiago@exemplo.com, contador@exemplo.com');
    const m = mails.at(-1)!;
    expect(m.to).toEqual(['thiago@exemplo.com', 'contador@exemplo.com']);
    expect(m.raw).toMatch(/filename="?lendcontrol-backup-.*\.xlsx/);
  });
});

describe('Restauração', () => {
  it('rejeita arquivo que não é backup e planilha sem abas', async () => {
    const bad = await preview(owner, Buffer.from('não sou excel'), 'x.xlsx');
    expect(bad.body.valid).toBe(false);
    expect(bad.body.errors[0]).toMatch(/não é uma planilha/);
    const wb = await load(xlsx);
    wb.removeWorksheet(wb.getWorksheet('6_REPASSES')!.id);
    const broken = await preview(owner, Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx');
    expect(broken.body.valid).toBe(false);
    expect(broken.body.errors).toContain('Aba 6_REPASSES não encontrada');
  });

  it('backup criptografado exige a senha do arquivo', async () => {
    expect((await call(owner, 'POST', `/backups/${backupId}/encrypted`, { password: '123' })).status).toBe(400);
    const enc = await call(owner, 'POST', `/backups/${backupId}/encrypted`, { password: 'arquivo-secreto' });
    expect(enc.status).toBe(200);
    const buf = enc.body as Buffer;
    expect(buf.subarray(0, 6).toString()).toBe('LCBAK1');
    expect(buf.includes(Buffer.from('1_CLIENTES'))).toBe(false);
    expect((await preview(owner, buf, 'b.lcbak')).body.code).toBe('FILE_PASSWORD_REQUIRED');
    expect((await preview(owner, buf, 'b.lcbak', 'errada')).body.code).toBe('FILE_PASSWORD_WRONG');
    const okPrev = await preview(owner, buf, 'b.lcbak', 'arquivo-secreto');
    expect(okPrev.body).toMatchObject({ valid: true, encrypted: true });
  });

  it('restaura com senha do Super Admin; dados novos somem, pagamento lançado na planilha vira recibo pendente', async () => {
    const clientsBefore = (await ok(owner, 'GET', '/clients')).items.length;
    // escolhe um empréstimo de juros ativo sem recibo pendente
    const loans = (await ok(owner, 'GET', '/loans?status=ATIVO')) as Json[];
    const pending = new Set(((await ok(owner, 'GET', '/payments?status=AGUARDANDO_APROVACAO')) as Json[]).map((p) => p.loanId ?? p.loan?.id));
    const loan = loans.find((l) => l.type === 'INTEREST_ONLY' && !pending.has(l.id))!;
    const quote = await ok(owner, 'GET', `/loans/${loan.id}/quote`);

    // planilha "editada à mão" com o sistema fora do ar: novo pagamento sem ID sistema
    const wb = await load(xlsx);
    const pay = wb.getWorksheet('4_PAGAMENTOS')!;
    let last = 1;
    pay.eachRow((r, n) => r.getCell(10).value && (last = n));
    const row = pay.getRow(last + 1);
    row.getCell(1).value = new Date();
    row.getCell(2).value = 'Cliente';
    row.getCell(3).value = loan.code;
    row.getCell(4).value = 'Juros';
    row.getCell(5).value = quote.interestOnlyCents / 100;
    row.commit();
    const edited = Buffer.from(await wb.xlsx.writeBuffer());

    // depois do backup, alguém cadastra um cliente (vai sumir na restauração)
    const created = await ok(owner, 'POST', '/clients', { form: { fullName: 'Cliente Pós Backup' }, draft: true });

    expect((await preview(carlos, edited, 'b.xlsx')).status).toBe(403);
    const pv = await preview(owner, edited, 'b.xlsx');
    expect(pv.body.valid).toBe(true);
    expect(pv.body.summary).toMatch(/^Planilha de \d{2}\/\d{2}\/\d{4} encontrada - \d+ clientes, \d+ empréstimos, \d+ parcelas - Confere\?$/);
    expect(pv.body.distribution.join(' | ')).toMatch(/clientes -> área Clientes.*empréstimos -> área Empréstimos/);
    expect(pv.body.offlinePayments).toEqual([expect.objectContaining({ loanCode: loan.code, type: 'JUROS', amountCents: quote.interestOnlyCents })]);

    expect((await call(owner, 'POST', '/backups/restore', { token: pv.body.token, password: 'errada' })).status).toBe(401);
    const r = await ok(owner, 'POST', '/backups/restore', { token: pv.body.token, password: PASS });
    expect(r.message).toBe('✅ Sistema restaurado com sucesso');
    expect(r.offlinePaymentsCreated).toHaveLength(1);
    expect(r.reloginRequired).toBe(false);
    // token é de uso único
    expect((await call(owner, 'POST', '/backups/restore', { token: pv.body.token, password: PASS })).status).toBe(400);

    expect((await call(owner, 'GET', `/clients/${created.id}`)).status).toBe(404);
    expect((await ok(owner, 'GET', '/clients')).items.length).toBe(clientsBefore);
    const pend = (await ok(owner, 'GET', '/payments?status=AGUARDANDO_APROVACAO')) as Json[];
    const mine = pend.find((p) => (p.loanId ?? p.loan?.id) === loan.id)!;
    expect(mine.amountCents ?? mine.valueCents).toBe(quote.interestOnlyCents);

    // segue funcionando: login, aprovação e novos empréstimos usam a sequência certa
    const relog = (await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
    expect((await ok(relog, 'GET', '/auth/me')).role).toBe('OPERATOR');
    await ok(gestor, 'POST', `/payments/${mine.id}/approve`, { password: PASS });

    const hist = await ok(owner, 'GET', '/backups');
    expect(hist.restores[0]).toMatchObject({ isRestore: true });
    expect(hist.backups.some((b: Json) => b.fileName.includes('antes-da-restauracao'))).toBe(true);
  });
});
