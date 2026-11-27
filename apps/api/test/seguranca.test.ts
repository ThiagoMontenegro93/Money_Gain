/** Segurança: bloqueio do acesso depois de várias senhas erradas. */
import { beforeAll, describe, expect, it } from 'vitest';


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


let owner: string;
const email = `bloqueio-${Date.now()}@lendcontrol.app`;
const SENHA = 'Senha@Forte1';
beforeAll(async () => {
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
});

describe('Bloqueio por senha errada', () => {
  let id: string;
  it('avisa quando faltam poucas tentativas e bloqueia na 5ª, mesmo com a senha certa depois', async () => {
    id = (await ok(owner, 'POST', '/users', { name: 'Teste Bloqueio', email, password: SENHA, role: 'OPERATOR' })).id;
    for (let i = 1; i <= 2; i++) expect((await call(null, 'POST', '/auth/login', { email, password: 'errada' })).status).toBe(401);
    const third = await call(null, 'POST', '/auth/login', { email, password: 'errada' });
    expect(third.body.message).toMatch(/Mais 2 tentativa/);
    await call(null, 'POST', '/auth/login', { email, password: 'errada' });
    const fifth = await call(null, 'POST', '/auth/login', { email, password: 'errada' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.message).toMatch(/15 min/);
    const right = await call(null, 'POST', '/auth/login', { email, password: SENHA });
    expect(right.status).toBe(423);
    const users = (await ok(owner, 'GET', '/users')) as Json[];
    expect(users.find((u) => u.id === id).lockedUntil).toBeTruthy();
  });

  it('só o dono desbloqueia; depois entra normal e o contador zera', async () => {
    const gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
    expect((await call(gestor, 'POST', `/users/${id}/unlock`)).status).toBe(403);
    const u = await ok(owner, 'POST', `/users/${id}/unlock`);
    expect(u.lockedUntil).toBeNull();
    const login = await ok(null as unknown as string, 'POST', '/auth/login', { email, password: SENHA });
    expect(login.accessToken).toBeTruthy();
    expect(login.user.failedLogins).toBe(0);
  });

  it('senha errada na confirmação (troca de senha, aprovação) também conta para o bloqueio', async () => {
    const t = (await ok('', 'POST', '/auth/login', { email, password: SENHA })).accessToken;
    for (let i = 0; i < 4; i++) expect((await call(t, 'PUT', '/users/me', { currentPassword: 'errada', newPassword: 'NovaSenha@123' })).status).toBe(401);
    const last = await call(t, 'PUT', '/users/me', { currentPassword: 'errada', newPassword: 'NovaSenha@123' });
    expect(last.status).toBe(423);
    expect((await call(null, 'POST', '/auth/login', { email, password: SENHA })).status).toBe(423);
    await ok(owner, 'POST', `/users/${id}/unlock`);
    await ok(owner, 'PUT', `/users/${id}`, { isActive: false });
  });
});
