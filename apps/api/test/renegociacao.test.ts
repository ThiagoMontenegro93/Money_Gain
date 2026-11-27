/** Negociação emergencial (acordo para não amargar prejuízo) e simulação "e se?" sem gravar. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayISO } from '@lendcontrol/core';

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

const today = todayISO();
let owner: string, carlos: string, gestor: string;
beforeAll(async () => {
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  carlos = (await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
  gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
});

describe('Negociação emergencial', () => {
  let loan: Json;
  const terms = () => ({ agreedCents: 500_000, installmentsCount: 5, method: 'MONTHLY', firstDueDate: addDays(today, 7) });

  it('cliente deve R$ 20 mil + juros e multa; prévia mostra acordo, desconto e prejuízo sem gravar nada', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    loan = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 2_000_000, ratePercent: 10, releaseDate: addDays(today, -95), allowLateFee: true, multaDiaPercent: 1 });
    const p = await ok(gestor, 'POST', `/loans/${loan.id}/renegotiate/preview`, terms());
    const fresh = await ok(owner, 'GET', `/loans/${loan.id}`);
    expect(p.debtCents).toBe(fresh.payoffCents);
    expect(p).toMatchObject({ saldoDevedorCents: 2_000_000, agreedCents: 500_000, principalCents: 500_000, writeOffCents: 1_500_000, revenueCents: 0 });
    expect(p.discountCents).toBe(p.debtCents - 500_000);
    expect(p.installments).toHaveLength(5);
    expect(p.installments[0]).toMatchObject({ valueCents: 100_000, dueDate: addDays(today, 7) });
    expect(fresh.status).toBe('ATIVO');
  });

  it('só gestor/dono, com senha e motivo', async () => {
    expect((await call(carlos, 'POST', `/loans/${loan.id}/renegotiate`, { ...terms(), reason: 'teste', password: PASS })).status).toBe(403);
    expect((await call(gestor, 'POST', `/loans/${loan.id}/renegotiate`, { ...terms(), reason: 'Cliente desempregado', password: 'errada' })).status).toBe(401);
    expect((await call(gestor, 'POST', `/loans/${loan.id}/renegotiate`, { ...terms(), reason: '', password: PASS })).status).toBe(400);
  });

  it('fecha o acordo: antigo vira RENEGOCIADO, nasce o acordo em 5x e o prejuízo vai para o caixa', async () => {
    const before = (await ok(owner, 'GET', '/auth/me')).wallet;
    const dashBefore = await ok(owner, 'GET', '/dashboard');
    const novo = await ok(gestor, 'POST', `/loans/${loan.id}/renegotiate`, { ...terms(), reason: 'Cliente desempregado, propôs pagar o que consegue', password: PASS });
    expect(novo).toMatchObject({ type: 'FIXED_INSTALLMENT', status: 'ATIVO', saldoDevedorCents: 500_000, allowAmortization: false, allowLateFee: false });
    expect(novo.installments).toHaveLength(5);
    expect(novo.renegotiatedFrom).toMatchObject({ oldLoanId: loan.id, agreedCents: 500_000, writeOffCents: 1_500_000 });
    const old = await ok(owner, 'GET', `/loans/${loan.id}`);
    expect(old.status).toBe('RENEGOCIADO');
    expect(old.saldoDevedorCents).toBe(0);
    expect(old.installments.every((i: Json) => i.status !== 'PENDENTE')).toBe(true);
    expect(old.renegotiatedTo).toMatchObject({ newLoanId: novo.id, newLoanCode: novo.code });
    const after = (await ok(owner, 'GET', '/auth/me')).wallet;
    expect(before.capitalEmprestadoCents - after.capitalEmprestadoCents).toBe(1_500_000);
    const ledger = (await ok(owner, 'GET', '/ledger')) as Json[];
    expect(ledger.find((e) => e.type === 'PERDA_RENEGOCIACAO' && e.loanId === loan.id).amountCents).toBe(-1_500_000);
    const dash = await ok(owner, 'GET', '/dashboard');
    expect(dash.renegociacoesMes.count - dashBefore.renegociacoesMes.count).toBe(1);
    expect(dash.renegociacoesMes.prejuizoCents - dashBefore.renegociacoesMes.prejuizoCents).toBe(1_500_000);
    const hist = (await ok(owner, 'GET', `/loans/renegotiations/list?clientId=${loan.clientId}`)) as Json[];
    expect(hist[0]).toMatchObject({ oldLoanCode: loan.code, newLoanCode: novo.code, reason: expect.stringMatching(/desempregado/) });
    // não renegocia duas vezes
    expect((await call(gestor, 'POST', `/loans/${loan.id}/renegotiate`, { ...terms(), reason: 'de novo', password: PASS })).status).toBe(400);
    // parcela do acordo paga devolve capital
    const p = await ok(owner, 'POST', '/payments', { loanId: novo.id, type: 'PARCELA', amountCents: 100_000, paidAt: today });
    const ap = await ok(gestor, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    expect(ap.allocation).toMatchObject({ principalCents: 100_000, interestCents: 0, fineCents: 0 });
  });

  it('recibo pendente bloqueia a renegociação', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    const l = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 10_000, ratePercent: 10, releaseDate: today });
    const p = await ok(owner, 'POST', '/payments', { loanId: l.id, type: 'JUROS', amountCents: 1_000, paidAt: today });
    const r = await call(gestor, 'POST', `/loans/${l.id}/renegotiate`, { agreedCents: 5_000, installmentsCount: 1, method: 'MONTHLY', firstDueDate: addDays(today, 5), reason: 'teste pendente', password: PASS });
    expect(r.status).toBe(409);
    await ok(gestor, 'POST', `/payments/${p.id}/reject`, { reason: 'teste' });
  });
});

describe('Simulação "e se?" (não grava)', () => {
  it('mostra antes e depois de mudar a % e o atraso longo, sem alterar o empréstimo', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    const l = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, releaseDate: addDays(today, -100), allowLateFee: true, multaDiaPercent: 1, longLateMode: 'OFF' });
    expect((await call(carlos, 'POST', `/loans/${l.id}/simulate`, { multaDiaPercent: 2 })).status).toBe(403);
    const r = await ok(gestor, 'POST', `/loans/${l.id}/simulate`, { multaDiaPercent: 2, longLateMode: 'FIXED', longLateAfterDays: 60, longLateFixedCents: 500 });
    expect(r.before.payoffCents).toBe(l.payoffCents);
    expect(r.after.payoffCents).toBeGreaterThan(r.before.payoffCents);
    expect(r.after.longLateCents).toBeGreaterThan(0);
    expect(r.diffPayoffCents).toBe(r.after.payoffCents - r.before.payoffCents);
    const same = await ok(owner, 'GET', `/loans/${l.id}`);
    expect(same).toMatchObject({ multaDiaPercent: 1, longLateMode: 'OFF', payoffCents: l.payoffCents });
    expect((await call(gestor, 'POST', `/loans/${l.id}/simulate`, { longLateMode: 'PERCENT', longLatePercent: 0 })).status).toBe(400);
  });
});
