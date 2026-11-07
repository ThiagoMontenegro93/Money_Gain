import { useSyncExternalStore } from 'react';

/**
 * Estado de conexão percebido pelo app (Fase 4): fica "offline" quando uma chamada à API falha
 * por rede (status 0) e volta ao primeiro sucesso. `cachedAt` = data mais antiga dos dados
 * servidos do cache enquanto offline (para o aviso "Offline — dados de dd/mm hh:mm").
 */
export interface NetState {
  offline: boolean;
  cachedAt: number | null;
}

let state: NetState = { offline: false, cachedAt: null };
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();

function set(next: NetState) {
  if (next.offline === state.offline && next.cachedAt === state.cachedAt) return;
  state = next;
  listeners.forEach((l) => l());
}

export function getNetState(): NetState {
  return state;
}

export function noteNetworkOk() {
  const wasOffline = state.offline || state.cachedAt != null;
  set({ offline: false, cachedAt: null });
  if (wasOffline) reconnectListeners.forEach((l) => l());
}

export function noteNetworkFail() {
  set({ ...state, offline: true });
}

export function noteCacheServed(t: number) {
  set({ offline: true, cachedAt: state.cachedAt == null ? t : Math.min(state.cachedAt, t) });
}

export function subscribeNet(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Disparado quando a API volta a responder depois de um período offline. */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

export function useNetState(): NetState {
  return useSyncExternalStore(subscribeNet, getNetState, getNetState);
}
