/**
 * "Baixar para usar sem internet": com internet, o app baixa em segundo plano a carteira do usuário
 * (painel, lista de clientes e empréstimos, ficha de cada cliente e detalhe de cada empréstimo em aberto)
 * para o cache do aparelho. Assim o funcionário abre qualquer cliente na rua, mesmo sem ter aberto antes.
 * Roda depois do login, quando a internet volta (depois de enviar a fila) e a cada 30 minutos.
 */
import { useSyncExternalStore } from 'react';
import { ApiError, request } from '../api/http';
import type { ClientListItem, LoanSummary } from '../api/types';
import { kvGet, kvSet } from './kv';
import { onReconnect } from './state';

const KEY = 'lc.prefetch.';
const EVERY_MS = 30 * 60_000;
const MAX_DETAILS = 400;
const PARALLEL = 4;
const OPEN = new Set(['ATIVO', 'PERDA', 'RENEGOCIADO']);

export interface PrefetchState {
  running: boolean;
  lastAt: number | null;
  done: number;
  total: number;
  error: string | null;
}
let userId: string | null = null;
let state: PrefetchState = { running: false, lastAt: null, done: 0, total: 0, error: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let unsub: (() => void) | null = null;

function set(p: Partial<PrefetchState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

async function pool<T>(list: T[], fn: (x: T) => Promise<void>) {
  let i = 0;
  let stop: unknown = null;
  const worker = async () => {
    while (i < list.length && !stop) {
      const x = list[i++];
      try {
        await fn(x);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) stop = e; // caiu a rede: para tudo
      }
      set({ done: state.done + 1 });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (stop) throw stop;
}

/** Baixa tudo agora. Sem `force`, não repete antes de 30 minutos. */
export async function prefetchForOffline(force = false): Promise<boolean> {
  const uid = userId;
  if (!uid || state.running) return false;
  if (!force && state.lastAt && Date.now() - state.lastAt < EVERY_MS) return false;
  set({ running: true, done: 0, total: 0, error: null });
  try {
    const [, clients, loans] = await Promise.all([
      request('GET', '/dashboard'),
      request<{ items: ClientListItem[] }>('GET', '/clients'),
      request<LoanSummary[]>('GET', '/loans'),
      request('GET', '/loans/settings').catch(() => null),
      request('GET', '/notifications').catch(() => null),
    ]);
    const detailPaths = [
      ...clients.items.slice(0, MAX_DETAILS).map((c) => `/clients/${encodeURIComponent(c.id)}`),
      ...loans.filter((l) => OPEN.has(l.status)).slice(0, MAX_DETAILS).map((l) => `/loans/${encodeURIComponent(l.id)}`),
    ];
    set({ total: detailPaths.length });
    await pool(detailPaths, async (p) => {
      if (userId !== uid) throw new ApiError(0, 'sessão trocada');
      await request('GET', p);
    });
    if (userId !== uid) return false;
    const now = Date.now();
    await kvSet(KEY + uid, String(now));
    set({ running: false, lastAt: now });
    return true;
  } catch (e) {
    set({ running: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Chamado pelo AuthContext ao entrar/sair. */
export async function setPrefetchUser(id: string | null) {
  if (id === userId) return;
  userId = id;
  const raw = id ? await kvGet(KEY + id).catch(() => null) : null;
  set({ running: false, done: 0, total: 0, error: null, lastAt: raw ? Number(raw) || null : null });
  if (!id) return;
  setTimeout(() => void prefetchForOffline(), 3000);
  if (!timer) timer = setInterval(() => void prefetchForOffline(), EVERY_MS);
  if (!unsub) unsub = onReconnect(() => setTimeout(() => void prefetchForOffline(), 5000));
}

export function usePrefetch(): PrefetchState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}
