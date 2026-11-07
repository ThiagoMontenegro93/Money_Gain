/**
 * Arquivos da fila offline - versão web: Blob no IndexedDB; se o IndexedDB estiver indisponível,
 * dataURL no localStorage com limite de tamanho. No nativo: fileStore.native.ts (documentDirectory).
 */
import type { PickedFile } from '../utils/files';
import { kvGet, kvRemove, kvSet } from './kv';

export interface StoredFile {
  key: string;
  name: string;
  type: string;
  size?: number;
  where: 'idb' | 'data' | 'fs';
  uri?: string;
}

/** Limite do fallback em dataURL (localStorage tem ~5 MB por origem). */
export const DATAURL_MAX = 2 * 1024 * 1024;
const DB = 'lendcontrol-offline';
const STORE = 'files';
const DATA_PREFIX = 'lc.outboxfile.';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) return reject(new Error('IndexedDB indisponível'));
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB falhou'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB abortado'));
    });
  } finally {
    db.close();
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(blob);
  });
}

function fromDataUrl(url: string, type: string): Blob {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Guarda o arquivo escolhido para ser enviado depois. */
export async function persistFile(f: PickedFile, key: string): Promise<StoredFile> {
  if (!f.file) throw new Error('Arquivo indisponível para guardar no aparelho');
  const base = { key, name: f.name, type: f.type, size: f.size ?? f.file.size };
  try {
    await idb('readwrite', (s) => s.put(f.file as Blob, key));
    return { ...base, where: 'idb' };
  } catch {
    if (f.file.size > DATAURL_MAX) throw new Error(`Sem internet, só é possível guardar arquivos de até ${DATAURL_MAX / 1024 / 1024} MB neste navegador. Reduza a foto ou envie quando a conexão voltar.`);
    const ok = await kvSet(DATA_PREFIX + key, await toDataUrl(f.file));
    if (!ok) throw new Error('Sem espaço no navegador para guardar o comprovante offline');
    return { ...base, where: 'data' };
  }
}

/** Parte do FormData para o upload do arquivo guardado. */
export async function filePart(s: StoredFile): Promise<Blob> {
  if (s.where === 'idb') {
    const blob = await idb<Blob | undefined>('readonly', (st) => st.get(s.key));
    if (!blob) throw new Error(`Arquivo "${s.name}" não está mais no aparelho`);
    return blob;
  }
  const url = await kvGet(DATA_PREFIX + s.key);
  if (!url) throw new Error(`Arquivo "${s.name}" não está mais no aparelho`);
  return fromDataUrl(url, s.type);
}

export async function removeFile(s: StoredFile): Promise<void> {
  if (s.where === 'idb') await idb('readwrite', (st) => st.delete(s.key)).catch(() => undefined);
  else await kvRemove([DATA_PREFIX + s.key]);
}
