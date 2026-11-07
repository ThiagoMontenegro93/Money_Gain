/** Conectividade - versão web: navigator.onLine + eventos online/offline. No nativo: network.native.ts (NetInfo). */
export function deviceOnline(): boolean {
  try {
    const n = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    return n?.onLine !== false;
  } catch {
    return true;
  }
}

export function onConnectivityChange(fn: (online: boolean) => void): () => void {
  const w = globalThis as unknown as { addEventListener?: (e: string, f: () => void) => void; removeEventListener?: (e: string, f: () => void) => void };
  if (!w.addEventListener) return () => {};
  const on = () => fn(true);
  const off = () => fn(false);
  w.addEventListener('online', on);
  w.addEventListener('offline', off);
  return () => {
    w.removeEventListener?.('online', on);
    w.removeEventListener?.('offline', off);
  };
}
