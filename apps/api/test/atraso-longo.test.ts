/** Opções por empréstimo: aceita amortização? cobra multa diária por atraso? (com padrão geral). */
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

describe('Cobrança especial por atraso longo', () => {
  let original: Json;
  afterAll(async () => {
    if (original) await ok(owner, 'PUT', '/loans/settings', original);
  });

  it('padrão geral: dono liga R$ fixo por dia a partir de 60 dias; validação recusa valor zerado', async () => {
    original = await ok(owner, 'GET', '/loans/settings');
    expect(original).toMatchObject({ longLateMode: 'OFF', longLateAfterDays: 60 });
    const bad = await call(owner, 'PUT', '/loans/settings', { ...original, longLateMode: 'FIXED', longLateFixedCents: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/valor fixo/);
    const saved = await ok(owner, 'PUT', '/loans/settings', { ...original, longLateMode: 'FIXED', longLateAfterDays: 60, longLateFixedCents: 1_000 });
    expect(saved).toMatchObject({ longLateMode: 'FIXED', longLateAfterDays: 60, longLateFixedCents: 1_000 });
  });

  let loanId: string;
  it('empréstimo com 70 dias de atraso herda o padrão: 11 dias × R$ 10 somados à parcela e à quitação', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    // mensal liberado há 100 dias: 1ª parcela venceu há ~70 dias
    const release = addDays(today, -100);
    const loan = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, releaseDate: release, allowLateFee: true, multaDiaPercent: 1 });
    loanId = loan.id;
    expect(loan).toMatchObject({ longLateMode: 'FIXED', longLateAfterDays: 60, longLateFixedCents: 1_000 });
    const first = loan.installments[0];
    expect(first.diasAtraso).toBeGreaterThanOrEqual(60);
    expect(first.longLateCents).toBe((first.diasAtraso - 59) * 1_000);
    expect(first.updatedCents).toBe(Math.round(110_000 * (1 + first.diasAtraso / 100)) + first.longLateCents);
    const q = await ok(owner, 'GET', `/loans/${loanId}/quote?asOf=${today}`);
    expect(q.payoff.longLateCents).toBe(first.longLateCents);
  });

  it('gestor troca para % ao dia (operador não pode) e pode desligar; tudo auditado', async () => {
    expect((await call(carlos, 'PATCH', `/loans/${loanId}/options`, { longLateMode: 'OFF' })).status).toBe(403);
    const pct = await ok(gestor, 'PATCH', `/loans/${loanId}/options`, { longLateMode: 'PERCENT', longLatePercent: 2, longLateAfterDays: 60 });
    const first = pct.installments[0];
    expect(first.longLateCents).toBe(Math.round(110_000 * 0.02 * (first.diasAtraso - 59)));
    const off = await ok(gestor, 'PATCH', `/loans/${loanId}/options`, { longLateMode: 'OFF' });
    expect(off.installments[0].longLateCents).toBe(0);
    expect(off.payoffCents).toBeLessThan(pct.payoffCents);
    const back = await ok(gestor, 'PATCH', `/loans/${loanId}/options`, { longLateMode: 'FIXED', longLateFixedCents: 1_000 });
    expect(back.installments[0].longLateCents).toBeGreaterThan(0);
    const bad = await call(gestor, 'PATCH', `/loans/${loanId}/options`, { longLateMode: 'PERCENT', longLatePercent: 0 });
    expect(bad.status).toBe(400);
  });

  it('quitação aprovada separa o ganho: pagamento, razão de caixa e painel mostram a cobrança por atraso longo', async () => {
    const dashBefore = await ok(owner, 'GET', '/dashboard');
    expect(dashBefore.atrasoLongoAReceberCents).toBeGreaterThan(0);
    const q = await ok(owner, 'GET', `/loans/${loanId}/quote?asOf=${today}`);
    const p = await ok(owner, 'POST', '/payments', { loanId, type: 'QUITACAO', amountCents: q.payoff.amountCents, paidAt: today });
    const approved = await ok(gestor, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    expect(approved.allocation.longLateCents).toBe(q.payoff.longLateCents);
    expect(approved.allocation.fineCents).toBe(q.payoff.fineCents);
    const ledger = (await ok(owner, 'GET', '/ledger')) as Json[];
    const mine = ledger.filter((e) => e.paymentId === p.id);
    expect(mine.find((e) => /atraso longo/.test(e.description)).amountCents).toBe(q.payoff.longLateCents);
    expect(mine.find((e) => /multa por atraso/.test(e.description)).amountCents).toBe(q.payoff.fineCents - q.payoff.longLateCents);
    const dash = await ok(owner, 'GET', '/dashboard');
    expect(dash.atrasoLongoRecebidoMesCents - (dashBefore.atrasoLongoRecebidoMesCents ?? 0)).toBe(q.payoff.longLateCents);
  });
});

describe('Opções sem efeito colateral', () => {
  it('mudar o atraso longo de um empréstimo com multa 0% não liga a multa padrão', async () => {
    const bom = (await ok(owner, 'GET', '/clients?classificacao=BOM')).items[0];
    const loan = await ok(owner, 'POST', '/loans', { clientId: bom.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 20_000, ratePercent: 10, releaseDate: today, allowLateFee: true, multaDiaPercent: 0, longLateMode: 'OFF' });
    expect(loan.multaDiaPercent).toBe(0);
    const after = await ok(gestor, 'PATCH', `/loans/${loan.id}/options`, { longLateMode: 'PERCENT', longLatePercent: 1 });
    expect(after.multaDiaPercent).toBe(0);
    expect(after.longLateMode).toBe('PERCENT');
  });
});
