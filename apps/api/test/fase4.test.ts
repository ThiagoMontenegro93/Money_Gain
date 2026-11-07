/**
 * Fase 4 (offline-first): cabeçalho Idempotency-Key nos POSTs reenviados pela fila do aparelho
 * e GET /health. Requer API rodando e seed aplicado (o script `pnpm test` reaplica o seed).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { addMonthsAnchored, todayISO } from '@lendcontrol/core';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'Lend@2026';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string | null, method: string, path: string, body?: unknown, key?: string) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const b = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body: b as Json, headers: res.headers };
}
const ok = async (t: string, m: string, p: string, b?: unknown, key?: string) => {
  const r = await call(t, m, p, b, key);
  if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex');
const upload = async (token: string, key?: string) => {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'pix.png');
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) }, body: fd });
  return { status: r.status, body: (await r.json()) as Json, replayed: r.headers.get('idempotent-replayed') };
};
const cpf = (seed: number) => {
  const n = String(Math.floor(seed)).padStart(9, '0').slice(-9).split('').map(Number);
  const dv = (arr: number[]) => {
    const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join('').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};
const fullForm = (over: Record<string, unknown> = {}) => ({
  fullName: 'Cliente Fase 4', cpf: cpf(Math.random() * 1e9), birthDate: '1990-03-15', whatsapp: '(21) 99123-4567',
  cep: '20745-000', street: 'Rua das Flores', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ',
  pixKey: 'teste@email.com', pixType: 'EMAIL', emergencyName: 'Maria', emergencyRelation: 'MAE', emergencyPhone1: '(21) 97777-7777',
  hasGuarantor: false, lgpdConsent: true, ...over,
});

const today = todayISO();
let owner: string, carlos: string, gestor: string;

beforeAll(async () => {
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  carlos = (await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
  gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
});

describe('GET /health', () => {
  it('é público e informa banco, redis e versão', async () => {
    const r = await call(null, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.db).toBe(true);
    expect(['ok', 'off', 'erro']).toContain(r.body.redis);
    expect(r.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('Idempotency-Key', () => {
  it('recibo: repetir o POST /payments com a mesma chave devolve o mesmo id e cria um só pagamento', async () => {
    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Idempotência Recibo' }) });
    const loan = await ok(owner, 'POST', '/loans', { clientId: c.id, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 10000, ratePercent: 10, multaDiaPercent: 0, releaseDate: addMonthsAnchored(today, -1) });
    const key = randomUUID();
    const body = { loanId: loan.id, type: 'JUROS', amountCents: 1000, paidAt: today };
    const first = await call(owner, 'POST', '/payments', body, key);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('AGUARDANDO_APROVACAO');
    const again = await call(owner, 'POST', '/payments', body, key);
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    expect(again.body).toEqual(first.body);
    // sem a chave, a trava de recibo pendente continua valendo (nada é liquidado sem aprovação)
    const noKey = await call(owner, 'POST', '/payments', body);
    expect(noKey.status).toBe(409);
    const list = await ok(owner, 'GET', `/payments?loanId=${loan.id}`);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('AGUARDANDO_APROVACAO');
  });

  it('reenvios simultâneos com a mesma chave não duplicam', async () => {
    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Idempotência Paralela' }) });
    const key = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => call(owner, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'LIGACAO', result: 'Prometeu pagar sexta' }, key)));
    const created = rs.filter((r) => r.status === 201);
    expect(created.length).toBeGreaterThanOrEqual(1);
    for (const r of rs) expect([201, 409]).toContain(r.status);
    expect(new Set(created.map((r) => r.body.id)).size).toBe(1);
    const detail = await ok(owner, 'GET', `/clients/${c.id}`);
    expect(detail.collectionAttempts.filter((a: Json) => a.result === 'Prometeu pagar sexta')).toHaveLength(1);
    // depois de concluída, a repetição devolve o original
    const replay = await call(owner, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'LIGACAO', result: 'Prometeu pagar sexta' }, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created[0].body.id);
  });

  it('cliente (rascunho), upload e comprovante do cliente também são idempotentes', async () => {
    const name = `Rascunho Offline ${Date.now()}`;
    const key = randomUUID();
    const a = await ok(carlos, 'POST', '/clients', { form: { fullName: name }, draft: true }, key);
    const b = await ok(carlos, 'POST', '/clients', { form: { fullName: name }, draft: true }, key);
    expect(b.id).toBe(a.id);
    const found = await ok(owner, 'GET', `/clients?search=${encodeURIComponent(name)}`);
    expect((found.items ?? found).filter((x: Json) => x.fullName === name)).toHaveLength(1);

    const fk = randomUUID();
    const f1 = await upload(carlos, fk);
    const f2 = await upload(carlos, fk);
    expect(f1.status).toBe(201);
    expect(f2.status).toBe(201);
    expect(f2.replayed).toBe('true');
    expect(f2.body.id).toBe(f1.body.id);

    const rk = randomUUID();
    const rb = { fileId: f1.body.id, sentAt: today, informedValueCents: 1000, notes: 'offline' };
    const r1 = await ok(carlos, 'POST', `/clients/${a.id}/receipts`, rb, rk);
    const r2 = await ok(carlos, 'POST', `/clients/${a.id}/receipts`, rb, rk);
    expect(r2.id).toBe(r1.id);
    expect(await ok(carlos, 'GET', `/clients/${a.id}/receipts`)).toHaveLength(1);
  });

  it('a chave é por usuário: outro usuário com a mesma chave não lê o resultado alheio', async () => {
    const key = randomUUID();
    const mine = await upload(carlos, key);
    const theirs = await upload(owner, key);
    expect(theirs.status).toBe(201);
    expect(theirs.replayed).toBeNull();
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect((await upload(carlos, key)).body.id).toBe(mine.body.id);
    expect((await upload(owner, key)).body.id).toBe(theirs.body.id);

    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Chave Por Usuário' }) });
    const k2 = randomUUID();
    const x = await ok(owner, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'VISITA', result: 'Dono visitou' }, k2);
    const y = await call(gestor, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'LIGACAO', result: 'Gestor ligou' }, k2);
    expect(y.status).toBe(201);
    expect(y.body.id).not.toBe(x.id);
    expect(JSON.stringify(y.body)).not.toContain('Dono visitou');
  });

  it('erro de negócio não é guardado; chave reaproveitada em outra rota é recusada; chave inválida dá 400', async () => {
    const c = await ok(owner, 'POST', '/clients', { form: fullForm({ fullName: 'Cliente Chave Erro' }) });
    const key = randomUUID();
    const bad = await call(owner, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'LIGACAO', result: '' }, key);
    expect(bad.status).toBe(400);
    const good = await call(owner, 'POST', `/clients/${c.id}/collection-attempts`, { type: 'LIGACAO', result: 'Agora sim' }, key);
    expect(good.status).toBe(201);
    const other = await call(owner, 'POST', '/clients', { form: { fullName: 'Outra rota' }, draft: true }, key);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const invalid = await call(owner, 'POST', '/clients', { form: { fullName: 'Chave curta' }, draft: true }, 'x');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });
});
