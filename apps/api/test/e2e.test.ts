/**
 * Testes ponta a ponta da API (requer API rodando + seed aplicado).
 *   API_URL=http://localhost:3000/api pnpm --filter @lendcontrol/api test
 * Os testes criam os próprios clientes/empréstimos (com CPFs gerados) e não dependem
 * da ordem dos dados do seed, apenas dos usuários.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonthsAnchored, todayISO, addDays } from '@lendcontrol/core';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'Lend@2026';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const ok = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await call(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

function cpf(seed: number) {
  const d = String(100000000 + ((seed * 7919 + Date.now()) % 899999999)).slice(0, 9).split('').map(Number);
  const calc = (l: number) => { let s = 0; for (let i = 0; i < l; i++) s += d[i] * (l + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  d.push(calc(9)); d.push(calc(10));
  return d.join('');
}

const today = todayISO();
let owner: string, gestor: string, carlos: string;
let carlosId: string;

const fullForm = (over: Record<string, unknown> = {}) => ({
  fullName: 'Cliente Teste E2E', cpf: cpf(Math.random() * 1e6), birthDate: '1990-03-15', whatsapp: '(21) 99123-4567',
  cep: '20745-000', street: 'Rua das Flores', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ',
  pixKey: 'teste@email.com', pixType: 'EMAIL', emergencyName: 'Maria', emergencyRelation: 'MAE', emergencyPhone1: '(21) 97777-7777',
  hasGuarantor: false, lgpdConsent: true, ...over,
});

beforeAll(async () => {
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
  const c = await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS });
  carlos = c.accessToken;
  carlosId = c.user.id;
});

describe('auth e permissões', () => {
  it('rejeita senha errada e rota sem token', async () => {
    expect((await call(null, 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: 'x' })).status).toBe(401);
    expect((await call(null, 'GET', '/dashboard')).status).toBe(401);
    expect((await call('token-invalido', 'GET', '/dashboard')).status).toBe(401);
  });
  it('operador não cria usuário nem aprova', async () => {
    expect((await call(carlos, 'POST', '/users', { name: 'X', email: 'x@x.com', password: '12345678', role: 'ADMIN' })).status).toBe(403);
    expect((await call(carlos, 'POST', '/payments/qualquer/approve', { password: PASS })).status).toBe(403);
  });
  it('me devolve carteira', async () => {
    const me = await ok(carlos, 'GET', '/auth/me');
    expect(me.role).toBe('OPERATOR');
    expect(me.wallet).toHaveProperty('capitalDisponivelCents');
  });
});

describe('clientes - ficha 5 abas', () => {
  it('valida obrigatórios e CPF', async () => {
    const r = await call(owner, 'POST', '/clients', { form: { fullName: 'Incompleto', cpf: '123.456.789-00' } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/CPF inválido/);
    expect(r.body.message).toMatch(/WhatsApp Principal é obrigatório/);
  });

  it('salva rascunho só com nome e completa depois', async () => {
    const draft = await ok(carlos, 'POST', '/clients', { form: { fullName: 'Rascunho Teste' }, draft: true });
    expect(draft.status).toBe('RASCUNHO');
    expect(draft.progress.percent).toBeLessThan(20);
    const check = await ok(carlos, 'GET', `/loans/credit-check?clientId=${draft.id}`);
    expect(check.level).toBe('BLOCKED');
    const full = await ok(carlos, 'PUT', `/clients/${draft.id}`, { form: fullForm({ fullName: 'Rascunho Completo' }) });
    expect(full.status).toBe('ATIVO');
    expect(full.progress.percent).toBeGreaterThanOrEqual(60);
  });

  it('importa bloco do WhatsApp e salva com CPF criptografado/mascarado', async () => {
    const doc = cpf(42);
    const parsed = await ok(owner, 'POST', '/clients/import/parse', {
      text: `Nome: Carla Mendes\nCPF: ${doc}\nNascimento: 01/02/1993\nWhatsApp: 21 98765-4321\nEndereço: Rua A 50, Centro, Rio - RJ\nCEP: 20745-000\nPIX: 21987654321 (celular)\nEmergência: Rosa Mendes (Mãe) - 21 97654-3210`,
    });
    expect(parsed.data).toMatchObject({ fullName: 'Carla Mendes', state: 'RJ', pixType: 'CELULAR', emergencyRelation: 'MAE' });
    const saved = await ok(owner, 'POST', '/clients', { form: { ...parsed.data, lgpdConsent: true } });
    expect(saved.form.cpf).toMatch(/^\*\*\*\./);
    expect(saved.whatsappImportedAt).not.toBeNull();
    const revealed = await ok(owner, 'GET', `/clients/${saved.id}/cpf`);
    expect(revealed.cpf.replace(/\D/g, '')).toBe(doc);
    // CPF duplicado
    const dup = await call(owner, 'POST', '/clients', { form: { ...parsed.data, fullName: 'Outra' } });
    expect(dup.status).toBe(409);
    // busca por CPF completo
    const found = await ok(owner, 'GET', `/clients?search=${doc}`);
    expect(found.items.map((x: Json) => x.id)).toContain(saved.id);
    // edição sem reenviar CPF mantém o CPF
    const edited = await ok(owner, 'PUT', `/clients/${saved.id}`, { form: { profession: 'Designer', cpf: saved.form.cpf } });
    expect(edited.form.profession).toBe('Designer');
    expect((await ok(owner, 'GET', `/clients/${saved.id}/cpf`)).cpf.replace(/\D/g, '')).toBe(doc);
  });

  it('lista ordenada BOM -> PERDA com contadores e filtros', async () => {
    const all = await ok(owner, 'GET', '/clients');
    const order = { BOM: 0, REGULAR: 1, RUIM: 2, PERDA: 3 } as Record<string, number>;
    const seq = all.items.map((x: Json) => order[x.classificacao]);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    expect(all.counts.PERDA).toBeGreaterThanOrEqual(1);
    const perda = await ok(owner, 'GET', '/clients?classificacao=PERDA');
    expect(perda.items.every((x: Json) => x.classificacao === 'PERDA')).toBe(true);
    const atrasados = await ok(owner, 'GET', '/clients?overdue=true');
    expect(atrasados.items.every((x: Json) => x.overdueCount > 0)).toBe(true);
  });

  it('operador só vê os próprios clientes', async () => {
    const mine = await ok(carlos, 'GET', '/clients');
    const all = await ok(owner, 'GET', '/clients');
    expect(mine.items.length).toBeLessThan(all.items.length);
    const notMine = all.items.find((x: Json) => !mine.items.some((m: Json) => m.id === x.id));
    expect((await call(carlos, 'GET', `/clients/${notMine.id}`)).status).toBe(404);
  });

  it('CEP com fallback', async () => {
    const r = await ok(owner, 'GET', '/cep/20745000');
    expect(r.found).toBe(true);
    expect(r.state).toBe('RJ');
  });
});

describe('trava de crédito e estratégias', () => {
  it('PERDA bloqueia; Super Admin desbloqueia com senha e motivo', async () => {
    const perda = (await ok(owner, 'GET', '/clients?classificacao=PERDA')).items[0];
    const detail = await ok(owner, 'GET', `/clients/${perda.id}`);
    expect(detail.creditLock.level).toBe('BLOCKED');
    expect(detail.strategies.map((s: Json) => s.key)).toEqual(expect.arrayContaining(['carta', 'acordo', 'juridico']));
    const loan = await call(owner, 'POST', '/loans', { clientId: perda.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 10000, ratePercent: 10, multaDiaPercent: 1, releaseDate: today });
    expect(loan.status).toBe(400);
    expect(loan.body.code).toBe('CREDIT_BLOCKED');
    expect((await call(gestor, 'POST', `/clients/${perda.id}/unblock`, { password: PASS, reason: 'acordo feito' })).status).toBe(403);
    expect((await call(owner, 'POST', `/clients/${perda.id}/unblock`, { password: 'errada', reason: 'acordo feito' })).status).toBe(401);
    const unblocked = await ok(owner, 'POST', `/clients/${perda.id}/unblock`, { password: PASS, reason: 'Acordo presencial com testemunha' });
    expect(unblocked.isBlocked).toBe(false);
    expect(unblocked.creditLock.level).toBe('WARNING');
    expect(unblocked.history[0].type).toBe('DESBLOQUEIO');
  });

  it('RUIM exige confirmação de risco', async () => {
    const ruim = (await ok(owner, 'GET', '/clients?classificacao=RUIM')).items[0];
    const detail = await ok(owner, 'GET', `/clients/${ruim.id}`);
    expect(detail.strategies.map((s: Json) => s.key)).toEqual(expect.arrayContaining(['desconto', 'parcelamento']));
    const body = { clientId: ruim.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 10000, ratePercent: 12, multaDiaPercent: 1, releaseDate: today };
    const r = await call(owner, 'POST', '/loans', body);
    expect(r.body.code).toBe('RISK_NOT_ACKNOWLEDGED');
    expect((await ok(owner, 'POST', '/loans', { ...body, riskAcknowledged: true })).status).toBe('ATIVO');
  });

  it('registra tentativa de cobrança', async () => {
    const ruim = (await ok(owner, 'GET', '/clients?classificacao=RUIM')).items[0];
    const a = await ok(owner, 'POST', `/clients/${ruim.id}/collection-attempts`, { type: 'LIGACAO_EMERGENCIA', result: 'Mãe prometeu pagamento sexta' });
    expect(a.userName).toBe('Thiago');
  });

  it('cliente BOM recebe sugestões de fidelidade e desconto registra histórico', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items.find((x: Json) => x.activeLoans > 0);
    const d = await ok(owner, 'GET', `/clients/${bom.id}`);
    expect(d.fidelity.limit.toCents).toBe(Math.round(d.fidelity.limit.fromCents * 1.5));
    const disc = d.fidelity.discount;
    const after = await ok(owner, 'POST', `/clients/${bom.id}/fidelity`, { kind: 'DISCOUNT', loanId: disc.loanId, newRatePercent: disc.toRate });
    expect(after.history[0].message).toMatch(/Desconto fidelidade aplicado por Thiago/);
    const loan = await ok(owner, 'GET', `/loans/${disc.loanId}`);
    expect(loan.ratePercent).toBe(disc.toRate);
  });
});

describe('empréstimo + projeção + aprovação (fluxo completo do re-empréstimo)', () => {
  let clientId: string;
  let loanId: string;
  const release = addMonthsAnchored(today, -1); // liberado há 1 mês: parcela 1 vence hoje

  it('dono repassa capital ao Carlos', async () => {
    const before = (await ok(carlos, 'GET', '/auth/me')).wallet.capitalDisponivelCents;
    await ok(owner, 'POST', '/transfers', { type: 'REPASSE_CAPITAL', valueCents: 200000, toUserId: carlosId });
    const after = (await ok(carlos, 'GET', '/auth/me')).wallet.capitalDisponivelCents;
    expect(after - before).toBe(200000);
  });

  it('preview mostra quitação + 3 projeções', async () => {
    const p = await ok(carlos, 'POST', '/loans/preview', { type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100000, ratePercent: 10, multaDiaPercent: 1, releaseDate: '2026-10-30' });
    expect(p.installments.map((i: Json) => [i.dueDate, i.originalCents])).toEqual([
      ['2026-11-30', 110000], ['2026-12-30', 10000], ['2027-01-30', 10000], ['2027-02-28', 10000],
    ]);
  });

  it('Carlos empresta R$1.000 (debita a carteira) e respeita o saldo', async () => {
    const c = await ok(carlos, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Fluxo Completo' }) });
    clientId = c.id;
    const before = (await ok(carlos, 'GET', '/auth/me')).wallet;
    const loan = await ok(carlos, 'POST', '/loans', { clientId, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100000, ratePercent: 10, multaDiaPercent: 1, releaseDate: release });
    loanId = loan.id;
    expect(loan.installments).toHaveLength(4);
    expect(loan.funder.name).toBe('Thiago');
    expect(loan.lender.name).toBe('Carlos');
    const after = (await ok(carlos, 'GET', '/auth/me')).wallet;
    expect(before.capitalDisponivelCents - after.capitalDisponivelCents).toBe(100000);
    expect(after.capitalEmprestadoCents - before.capitalEmprestadoCents).toBe(100000);
    const tooBig = await call(carlos, 'POST', '/loans', { clientId, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 900000000, ratePercent: 10, multaDiaPercent: 1, releaseDate: today });
    expect(tooBig.body.code).toBe('INSUFFICIENT_CAPITAL');
  });

  it('operador precisa de comprovante; recibo fica AGUARDANDO_APROVACAO sem baixar parcela', async () => {
    const noProof = await call(carlos, 'POST', '/payments', { loanId, type: 'JUROS', amountCents: 10000, paidAt: today });
    expect(noProof.body.code).toBe('PROOF_REQUIRED');
    const fd = new FormData();
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex');
    fd.append('file', new Blob([png], { type: 'image/png' }), 'pix.png');
    const up = await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${carlos}` }, body: fd });
    expect(up.status).toBe(201);
    const file = await up.json();
    const signed = await ok(owner, 'GET', `/files/${file.id}/url`);
    expect((await fetch(signed.url)).status).toBe(200);
    expect((await fetch(signed.url.replace(/sig=\w+/, 'sig=' + '0'.repeat(64)))).status).toBe(403);

    const tooLow = await call(carlos, 'POST', '/payments', { loanId, type: 'JUROS', amountCents: 5000, paidAt: today, comprovanteFileId: file.id });
    expect(tooLow.body.code).toBe('INSUFFICIENT_AMOUNT');
    const p = await ok(carlos, 'POST', '/payments', { loanId, type: 'JUROS', amountCents: 10000, paidAt: today, comprovanteFileId: file.id });
    expect(p.status).toBe('AGUARDANDO_APROVACAO');
    expect(p.expectedValueCents).toBe(10000);
    const dup = await call(carlos, 'POST', '/payments', { loanId, type: 'JUROS', amountCents: 10000, paidAt: today, comprovanteFileId: file.id });
    expect(dup.status).toBe(409);
    const loan = await ok(carlos, 'GET', `/loans/${loanId}`);
    expect(loan.installments[0].status).toBe('PENDENTE');
  });

  it('aprovação: senha obrigatória, aplica projeção, comissão e carteira', async () => {
    const pending = (await ok(gestor, 'GET', `/payments?status=AGUARDANDO_APROVACAO&loanId=${loanId}`))[0];
    expect((await call(gestor, 'POST', `/payments/${pending.id}/approve`, { password: 'errada' })).status).toBe(401);
    const before = (await ok(carlos, 'GET', '/auth/me')).wallet;
    const approved = await ok(gestor, 'POST', `/payments/${pending.id}/approve`, { password: PASS });
    expect(approved.status).toBe('APROVADO');
    expect(approved.approvedBy.name).toBe('Gestor');
    expect(approved.allocation).toMatchObject({ interestCents: 10000, principalCents: 0, commissionCents: 3000 });
    expect(approved.resultMessage).toMatch(/Nova projeção criada/);
    expect((await call(gestor, 'POST', `/payments/${pending.id}/approve`, { password: PASS })).status).toBe(409);

    const after = (await ok(carlos, 'GET', '/auth/me')).wallet;
    expect(after.paraRepassarCents - before.paraRepassarCents).toBe(10000);
    expect(after.comissaoAPagarCents - before.comissaoAPagarCents).toBe(3000);
    const loan = await ok(carlos, 'GET', `/loans/${loanId}`);
    const open = loan.installments.filter((i: Json) => i.status === 'PENDENTE');
    expect(open).toHaveLength(4);
    expect(open[0]).toMatchObject({ number: 2, type: 'QUITACAO_PREVISTA', originalCents: 110000 });
    expect(loan.installments[0]).toMatchObject({ status: 'PAGA', paidKind: 'JUROS' });
    expect(loan.quote.nextProjectionDate).toBe(addMonthsAnchored(release, 6));
  });

  it('admin não aprova o próprio lançamento', async () => {
    const other = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Gestor' }) });
    const loan = await ok(gestor, 'POST', '/loans', { clientId: other.id, type: 'INTEREST_ONLY', method: 'WEEKLY', principalCents: 20000, ratePercent: 5, multaDiaPercent: 0, releaseDate: addDays(today, -7) });
    const p = await ok(gestor, 'POST', '/payments', { loanId: loan.id, type: 'JUROS', amountCents: 1000, paidAt: today });
    const self = await call(gestor, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    expect(self.body.code).toBe('SELF_APPROVAL');
    const rej = await ok(owner, 'POST', `/payments/${p.id}/reject`, { reason: 'Comprovante ilegível' });
    expect(rej.status).toBe('REJEITADO');
  });

  it('simular e quitar: remove projeções, devolve principal à carteira (revolving)', async () => {
    const q = await ok(carlos, 'GET', `/loans/${loanId}/quote?asOf=${today}`);
    expect(q.payoff.amountCents).toBe(110000);
    expect(q.payoff.cancelledNumbers).toHaveLength(3);
    const file = await (async () => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('%PDF-1.4 teste')], { type: 'application/pdf' }), 'pix.pdf');
      return (await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${carlos}` }, body: fd })).json();
    })();
    const before = (await ok(carlos, 'GET', '/auth/me')).wallet;
    const p = await ok(carlos, 'POST', '/payments', { loanId, type: 'QUITACAO', amountCents: q.payoff.amountCents, paidAt: today, comprovanteFileId: file.id });
    const approved = await ok(owner, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    expect(approved.resultMessage).toMatch(/Quitado em .* - 3 parcelas de projeção removidas/);
    const loan = await ok(carlos, 'GET', `/loans/${loanId}`);
    expect(loan.status).toBe('QUITADO');
    expect(loan.installments.filter((i: Json) => i.status === 'CANCELADA')).toHaveLength(3);
    const after = (await ok(carlos, 'GET', '/auth/me')).wallet;
    expect(after.capitalDisponivelCents - before.capitalDisponivelCents).toBe(100000);
    expect(before.capitalEmprestadoCents - after.capitalEmprestadoCents).toBe(100000);
    expect(after.paraRepassarCents - before.paraRepassarCents).toBe(10000);
  });

  it('Carlos repassa para o dono e o dono aprova', async () => {
    const me = (await ok(carlos, 'GET', '/auth/me')).wallet;
    const tooMuch = await call(carlos, 'POST', '/transfers', { type: 'REPASSE_LUCRO', valueCents: me.paraRepassarCents + 1 });
    expect(tooMuch.status).toBe(400);
    const t = await ok(carlos, 'POST', '/transfers', { type: 'REPASSE_LUCRO', valueCents: 10000, notes: 'PIX para o dono' });
    expect(t.status).toBe('AGUARDANDO_APROVACAO');
    const approved = await ok(owner, 'POST', `/transfers/${t.id}/approve`, { password: PASS });
    expect(approved.status).toBe('APROVADO');
    const after = (await ok(carlos, 'GET', '/auth/me')).wallet;
    expect(me.paraRepassarCents - after.paraRepassarCents).toBe(10000);
    const ledger = await ok(carlos, 'GET', '/ledger');
    expect(ledger.some((l: Json) => l.type === 'REPASSE_LUCRO' && l.amountCents === -10000)).toBe(true);
    // dono paga comissão
    const pc = await ok(owner, 'POST', '/transfers', { type: 'PAGAMENTO_COMISSAO', valueCents: 3000, toUserId: carlosId });
    expect(pc.status).toBe('APROVADO');
  });

  it('parcela fixa (Price) e amortização', async () => {
    const loan = await ok(carlos, 'POST', '/loans', { clientId, type: 'FIXED_INSTALLMENT', method: 'MONTHLY', principalCents: 30000, ratePercent: 5, multaDiaPercent: 0.5, releaseDate: today, installmentsCount: 3 });
    expect(loan.installments.every((i: Json) => i.type === 'PARCELA_FIXA')).toBe(true);
    const sum = loan.installments.reduce((s: number, i: Json) => s + i.principalCents, 0);
    expect(sum).toBe(30000);
    const r = await call(carlos, 'POST', '/payments', { loanId: loan.id, type: 'JUROS', amountCents: 1500, paidAt: today, comprovanteFileId: 'x' });
    expect(r.status).toBe(400);
  });
});

describe('regressões de segurança e concorrência', () => {
  it('operador não obtém URL de arquivo de outro usuário', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('%PDF-1.4 privado')], { type: 'application/pdf' }), 'doc.pdf');
    const f = await (await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${gestor}` }, body: fd })).json();
    expect((await call(carlos, 'GET', `/files/${f.id}/url`)).status).toBe(404);
    expect((await call(owner, 'GET', `/files/${f.id}/url`)).status).toBe(200);
    // e não pode usar como comprovante
    const loans = await ok(carlos, 'GET', '/loans?status=ATIVO');
    const r = await call(carlos, 'POST', '/payments', { loanId: loans[0].id, type: 'JUROS', amountCents: 99999999, paidAt: today, comprovanteFileId: f.id });
    expect(r.status).toBe(400);
  });

  it('duplo clique gera só um recibo pendente', async () => {
    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Concorrência' }) });
    const loan = await ok(owner, 'POST', '/loans', { clientId: c.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 10000, ratePercent: 10, multaDiaPercent: 0, releaseDate: addMonthsAnchored(today, -1) });
    const body = { loanId: loan.id, type: 'JUROS', amountCents: 1000, paidAt: today };
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(owner, 'POST', '/payments', body)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('dono que empresta direto debita o próprio caixa e recebe de volta só o devido', async () => {
    const before = (await ok(owner, 'GET', '/auth/me')).wallet;
    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Dono Direto' }) });
    const loan = await ok(owner, 'POST', '/loans', { clientId: c.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 50000, ratePercent: 10, multaDiaPercent: 0, releaseDate: addMonthsAnchored(today, -1) });
    const p = await ok(owner, 'POST', '/payments', { loanId: loan.id, type: 'QUITACAO', amountCents: 55000, paidAt: today });
    await ok(owner, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    const after = (await ok(owner, 'GET', '/auth/me')).wallet;
    expect(after.capitalDisponivelCents - before.capitalDisponivelCents).toBe(5000);
    expect(after.capitalEmprestadoCents).toBe(before.capitalEmprestadoCents);
  });
});

describe('dashboard e rotina diária', () => {
  it('dashboard do dono e do operador', async () => {
    const d = await ok(owner, 'GET', '/dashboard');
    expect(d.scoreCounts.BOM + d.scoreCounts.REGULAR + d.scoreCounts.RUIM + d.scoreCounts.PERDA).toBe(d.totalClients);
    expect(d.topBons.every((x: Json) => x.classificacao === 'BOM')).toBe(true);
    const op = await ok(carlos, 'GET', '/dashboard');
    expect(op.totalClients).toBeLessThanOrEqual(d.totalClients);
  });
  it('rotina diária é idempotente', async () => {
    const a = await ok(owner, 'POST', '/jobs/daily/run');
    const b = await ok(owner, 'POST', '/jobs/daily/run');
    expect(b.installmentsUpdated).toBe(0);
    expect(a.asOf).toBe(b.asOf);
    expect((await call(carlos, 'POST', '/jobs/daily/run')).status).toBe(403);
  });
});
