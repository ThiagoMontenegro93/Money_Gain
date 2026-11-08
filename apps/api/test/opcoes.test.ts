/** Opções por empréstimo: aceita amortização? cobra multa diária por atraso? (com padrão geral). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayISO } from '@lendcontrol/core';

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

describe('Opções do empréstimo: amortização e multa diária', () => {
  let original: Json;
  afterAll(async () => {
    if (original) await ok(owner, 'PUT', '/loans/settings', original);
  });

  it('padrão geral: só o dono altera', async () => {
    original = await ok(owner, 'GET', '/loans/settings');
    expect(original).toMatchObject({ allowAmortization: true, allowLateFee: true });
    expect((await call(carlos, 'PUT', '/loans/settings', original)).status).toBe(403);
    expect((await call(gestor, 'PUT', '/loans/settings', original)).status).toBe(403);
    const saved = await ok(owner, 'PUT', '/loans/settings', { allowAmortization: false, allowLateFee: false, multaDiaPercent: 2 });
    expect(saved).toEqual({ allowAmortization: false, allowLateFee: false, multaDiaPercent: 2 });
  });

  it('empréstimo novo herda o padrão: sem amortização e sem multa; amortização é recusada', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    const loan = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 50_000, ratePercent: 10, releaseDate: today });
    expect(loan).toMatchObject({ allowAmortization: false, allowLateFee: false, multaDiaPercent: 0 });
    const r = await call(owner, 'POST', '/payments', { loanId: loan.id, type: 'AMORTIZACAO', amountCents: 10_000, paidAt: today });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/não admite amortização/);
    // juros continuam aceitos
    const p = await ok(owner, 'POST', '/payments', { loanId: loan.id, type: 'JUROS', amountCents: 5_000, paidAt: today });
    expect(p.status).toBe('AGUARDANDO_APROVACAO');
    await ok(owner, 'POST', `/payments/${p.id}/reject`, { reason: 'teste' });
  });

  it('opções explícitas vencem o padrão; prévia respeita a escolha', async () => {
    const prev = await ok(owner, 'POST', '/loans/preview', { type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, releaseDate: today, allowLateFee: true, multaDiaPercent: 1 });
    expect(prev.installments).toHaveLength(4);
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    const loan = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 30_000, ratePercent: 10, releaseDate: today, allowAmortization: true, allowLateFee: true, multaDiaPercent: 1.5 });
    expect(loan).toMatchObject({ allowAmortization: true, allowLateFee: true, multaDiaPercent: 1.5 });
  });

  it('admin perdoa a multa de um empréstimo atrasado: valor volta ao original e fica auditado', async () => {
    const loans = (await ok(owner, 'GET', '/loans?status=ATIVO')) as Json[];
    const late = loans.find((l) => l.overdueCount > 0 && l.allowLateFee && l.multaDiaPercent > 0)!;
    const before = await ok(owner, 'GET', `/loans/${late.id}`);
    const overdue = before.installments.find((i: Json) => i.diasAtraso > 0);
    expect(overdue.updatedCents).toBeGreaterThan(overdue.originalCents);
    expect((await call(carlos, 'PATCH', `/loans/${late.id}/options`, { allowLateFee: false })).status).toBe(403);
    const after = await ok(gestor, 'PATCH', `/loans/${late.id}/options`, { allowLateFee: false });
    const same = after.installments.find((i: Json) => i.number === overdue.number);
    expect(after.allowLateFee).toBe(false);
    expect(same.diasAtraso).toBe(overdue.diasAtraso); // atraso continua contando (score)
    expect(same.updatedCents).toBe(same.originalCents);
    expect(after.payoffCents).toBeLessThan(before.payoffCents);
    // religa a multa
    const back = await ok(gestor, 'PATCH', `/loans/${late.id}/options`, { allowLateFee: true, multaDiaPercent: before.multaDiaPercent });
    expect(back.installments.find((i: Json) => i.number === overdue.number).updatedCents).toBe(overdue.updatedCents);
  });
});
