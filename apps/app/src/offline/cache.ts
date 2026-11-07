/**
 * Cache de leitura (Fase 4): respostas GET bem-sucedidas das telas de rua ficam guardadas no
 * aparelho por usuário + caminho e são servidas quando a rede falha (status 0).
 * Nunca guarda: CPF revelado, URLs assinadas de arquivos, backups, nada de /auth além de /auth/me.
 */
import { kvGet, kvKeys, kvRemove, kvSet } from './kv';

const PREFIX = 'lc.cache.';
const ALLOW: RegExp[] = [
  /^\/auth\/me$/,
  /^\/dashboard$/,
  /^\/clients$/,
  /^\/clients\/[^/]+$/,
  /^\/clients\/[^/]+\/(receipts|documents)$/,
  /^\/loans$/,
  /^\/loans\/[^/]+$/,
  /^\/loans\/[^/]+\/quote$/,
  /^\/payments$/,
  /^\/wallets$/,
  /^\/notifications$/,
  /^\/messaging\/templates$/,
];
/** Segmentos que casariam com /clients/:id ou /loans/:id mas não são dados de tela. */
const DENY = new Set(['/clients/lookup', '/loans/credit-check']);

let userId: string | null = null;
const mem = new Map<string, { t: number; d: unknown }>();

export function setCacheUser(id: string | null) {
  if (id !== userId) mem.clear();
  userId = id;
}

export function isCacheable(pathWithQuery: string): boolean {
  const path = pathWithQuery.split('?')[0];
  if (DENY.has(path)) return false;
  return ALLOW.some((r) => r.test(path));
}

const keyOf = (uid: string, pathWithQuery: string) => `${PREFIX}${uid}:${pathWithQuery}`;

export async function cacheWrite(pathWithQuery: string, data: unknown): Promise<void> {
  const uid = userId;
  if (!uid || !isCacheable(pathWithQuery)) return;
  const entry = { t: Date.now(), d: data };
  const key = keyOf(uid, pathWithQuery);
  mem.set(key, entry);
  const raw = JSON.stringify(entry);
  if (!(await kvSet(key, raw))) {
    // sem espaço: descarta o cache mais antigo deste usuário e tenta de novo
    await evictOldest(uid);
    await kvSet(key, raw);
  }
}

export async function cacheRead<T>(pathWithQuery: string): Promise<{ t: number; d: T } | null> {
  const uid = userId;
  if (!uid || !isCacheable(pathWithQuery)) return null;
  const key = keyOf(uid, pathWithQuery);
  const m = mem.get(key);
  if (m) return m as { t: number; d: T };
  const raw = await kvGet(key);
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as { t: number; d: T };
    mem.set(key, e);
    return e;
  } catch {
    return null;
  }
}

async function evictOldest(uid: string) {
  const keys = await kvKeys(`${PREFIX}${uid}:`);
  const dated: { k: string; t: number }[] = [];
  for (const k of keys) {
    try {
      dated.push({ k, t: (JSON.parse((await kvGet(k)) ?? '{}') as { t?: number }).t ?? 0 });
    } catch {
      dated.push({ k, t: 0 });
    }
  }
  dated.sort((a, b) => a.t - b.t);
  const drop = dated.slice(0, Math.max(1, Math.ceil(dated.length / 2))).map((x) => x.k);
  drop.forEach((k) => mem.delete(k));
  await kvRemove(drop);
}

/** Logout: apaga todo o cache de leitura do aparelho. */
export async function clearCache(): Promise<void> {
  mem.clear();
  await kvRemove(await kvKeys(PREFIX));
}
