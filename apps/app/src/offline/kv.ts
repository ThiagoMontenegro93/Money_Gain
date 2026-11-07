/**
 * Armazenamento chave-valor do modo offline - versão web (localStorage, sempre com try/catch:
 * modo privado / armazenamento bloqueado não pode quebrar o app). No nativo: kv.native.ts.
 */
const ls = (): Storage | null => {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
};

export async function kvGet(key: string): Promise<string | null> {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Retorna false se não coube (quota) ou se o armazenamento está indisponível. */
export async function kvSet(key: string, value: string): Promise<boolean> {
  try {
    const s = ls();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function kvRemove(keys: string[]): Promise<void> {
  try {
    const s = ls();
    for (const k of keys) s?.removeItem(k);
  } catch {
    /* indisponível */
  }
}

export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    const s = ls();
    if (!s) return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}
