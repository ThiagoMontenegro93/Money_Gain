/**
 * Fila de envio (outbox) da Fase 4: ações de rua do funcionário feitas sem internet ficam salvas
 * no aparelho e são enviadas na ordem (FIFO) quando a conexão volta.
 *
 * - Cada item tem uma Idempotency-Key gerada no aparelho: reenvios nunca duplicam no servidor.
 * - Arquivos (comprovante PIX, selfie...) sobem primeiro (POST /files com chave própria), depois o POST da ação.
 * - Erro de negócio (4xx: recibo pendente, validação...) marca o item como "falhou" com a mensagem - sem repetir.
 * - Erro de rede / 5xx: nova tentativa com espera crescente.
 * - Nada é liquidado offline: o recibo continua indo para AGUARDANDO_APROVACAO no servidor.
 */
import { useSyncExternalStore } from 'react';
import { ApiError, errorMessage, request } from '../api/http';
import type { FileDTO } from '../api/types';
import type { PickedFile } from '../utils/files';
import { filePart, persistFile, removeFile, type StoredFile } from './fileStore';
import { kvGet, kvSet } from './kv';
import { deviceOnline, onConnectivityChange } from './network';
import { noteNetworkFail } from './state';

export type OutboxKind = 'payment' | 'client' | 'attempt' | 'receipt';

export interface OutboxFile {
  /** Caminho do campo no corpo que recebe o id do arquivo (ex.: "comprovanteFileId", "form.selfieFileId"). */
  field: string;
  file: StoredFile;
  /** id no servidor depois do upload */
  uploadedId?: string;
}

export interface OutboxItem {
  /** Também é a Idempotency-Key do POST. */
  id: string;
  kind: OutboxKind;
  label: string;
  path: string;
  body: Record<string, unknown>;
  files: OutboxFile[];
  createdAt: number;
  attempts: number;
  nextAt: number;
  status: 'pending' | 'failed';
  error?: string;
  /** Para a tela mostrar o que está na fila (ex.: loanId, clientId). */
  meta?: Record<string, string>;
}

export const QUEUED_MESSAGE = 'Salvo no aparelho — será enviado quando a internet voltar';
const PREFIX = 'lc.outbox.';
const PERIOD_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

let userId: string | null = null;
let items: OutboxItem[] = [];
let syncing = false;
let lastSyncAt: number | null = null;
const listeners = new Set<() => void>();
const sentListeners = new Set<(item: OutboxItem, response: unknown) => void>();
let snapshot: { items: OutboxItem[]; syncing: boolean; lastSyncAt: number | null } = { items, syncing, lastSyncAt };

function emit() {
  snapshot = { items, syncing, lastSyncAt };
  listeners.forEach((l) => l());
}

async function save() {
  if (!userId) return;
  await kvSet(PREFIX + userId, JSON.stringify(items));
}

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Arquivos escolhidos sem internet: ficam em memória até a ação ser salva na fila
// ---------------------------------------------------------------------------

const held = new Map<string, PickedFile>();
export const LOCAL_PREFIX = 'local:';
export const isLocalFileRef = (id: string | null | undefined): id is string => !!id && id.startsWith(LOCAL_PREFIX);

/** Guarda o arquivo escolhido offline e devolve uma referência local ("local:...") para o formulário. */
export function holdFile(f: PickedFile): string {
  const ref = LOCAL_PREFIX + uuid();
  held.set(ref, f);
  return ref;
}
export const heldFile = (ref: string) => held.get(ref) ?? null;

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

/** Chamado pelo AuthContext: carrega a fila do usuário logado (cada usuário tem a sua). */
export async function setOutboxUser(id: string | null) {
  if (id === userId) return;
  userId = id;
  items = [];
  if (id) {
    try {
      const raw = await kvGet(PREFIX + id);
      items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    } catch {
      items = [];
    }
  }
  emit();
  if (id && pendingCount()) startTimer();
  if (id) void syncNow();
}

// ---------------------------------------------------------------------------
// Enfileirar / enviar
// ---------------------------------------------------------------------------

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), obj);
}

export interface SubmitSpec {
  kind: OutboxKind;
  label: string;
  path: string;
  body: Record<string, unknown>;
  /** Campos do corpo que podem conter uma referência local de arquivo ("local:..."). */
  fileFields?: string[];
  meta?: Record<string, string>;
}

async function enqueue(spec: SubmitSpec, id: string): Promise<OutboxItem> {
  if (!userId) throw new Error('Faça login para salvar no aparelho');
  const body = JSON.parse(JSON.stringify(spec.body)) as Record<string, unknown>;
  const files: OutboxFile[] = [];
  for (const field of spec.fileFields ?? []) {
    const v = getPath(body, field);
    if (!isLocalFileRef(v as string)) continue;
    const f = heldFile(v as string);
    if (!f) throw new Error('O arquivo escolhido sem internet não está mais disponível. Anexe novamente.');
    files.push({ field, file: await persistFile(f, `${id}-${files.length}`) });
    setPath(body, field, null);
  }
  const item: OutboxItem = { id, kind: spec.kind, label: spec.label, path: spec.path, body, files, createdAt: Date.now(), attempts: 0, nextAt: Date.now(), status: 'pending', meta: spec.meta };
  items = [...items, item];
  await save();
  emit();
  startTimer();
  return item;
}

/**
 * Envia agora com Idempotency-Key; sem internet (status 0) ou com arquivo guardado offline,
 * salva na fila com a mesma chave. `queued: true` => a tela deve avisar QUEUED_MESSAGE.
 */
export async function submitOrQueue<T>(spec: SubmitSpec): Promise<{ queued: false; data: T } | { queued: true; item: OutboxItem }> {
  const id = uuid();
  const hasLocal = (spec.fileFields ?? []).some((f) => isLocalFileRef(getPath(spec.body, f) as string));
  // há algo antes na fila: mantém a ordem (FIFO) em vez de "furar" a fila
  const queueAhead = items.some((i) => i.status === 'pending');
  if (!hasLocal && !queueAhead) {
    try {
      const data = await request<T>('POST', spec.path, { body: spec.body, headers: { 'Idempotency-Key': id }, timeoutMs: 30_000 });
      return { queued: false, data };
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) throw e;
    }
  }
  const item = await enqueue(spec, id);
  // se a rede voltou nesse meio tempo (ou a fila só estava esperando), tenta enviar já
  if (deviceOnline()) void syncNow();
  return { queued: true, item };
}

export async function discard(id: string) {
  const it = items.find((i) => i.id === id);
  items = items.filter((i) => i.id !== id);
  await save();
  emit();
  for (const f of it?.files ?? []) await removeFile(f.file);
}

/** Recoloca um item que falhou na fila (ex.: depois que o admin decidiu o recibo pendente). */
export async function retry(id: string) {
  items = items.map((i) => (i.id === id ? { ...i, status: 'pending', error: undefined, attempts: 0, nextAt: Date.now() } : i));
  await save();
  emit();
  void syncNow();
}

export function onItemSent(fn: (item: OutboxItem, response: unknown) => void): () => void {
  sentListeners.add(fn);
  return () => sentListeners.delete(fn);
}

const transient = (e: unknown) =>
  !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429 || e.code === 'IDEMPOTENCY_IN_PROGRESS';

async function sendItem(item: OutboxItem): Promise<unknown> {
  for (let i = 0; i < item.files.length; i++) {
    const f = item.files[i];
    if (!f.uploadedId) {
      const form = new FormData();
      form.append('file', await filePart(f.file), f.file.name);
      const up = await request<FileDTO>('POST', '/files', { form, headers: { 'Idempotency-Key': `${item.id}.f${i}` }, timeoutMs: 120_000 });
      f.uploadedId = up.id;
      await save();
    }
  }
  const body = JSON.parse(JSON.stringify(item.body)) as Record<string, unknown>;
  for (const f of item.files) setPath(body, f.field, f.uploadedId);
  return request('POST', item.path, { body, headers: { 'Idempotency-Key': item.id }, timeoutMs: 30_000 });
}

/** Processa a fila (FIFO). `force` ignora a espera entre tentativas ("Sincronizar agora"). */
export async function syncNow(force = false): Promise<{ sent: number; failed: number }> {
  if (syncing || !userId) return { sent: 0, failed: 0 };
  const owner = userId;
  syncing = true;
  emit();
  let sent = 0;
  let failed = 0;
  try {
    for (const item of [...items]) {
      if (userId !== owner) break;
      if (item.status !== 'pending') continue;
      if (!force && item.nextAt > Date.now()) break; // mantém a ordem: espera o primeiro da fila
      try {
        const res = await sendItem(item);
        items = items.filter((i) => i.id !== item.id);
        await save();
        sent++;
        for (const f of item.files) await removeFile(f.file);
        sentListeners.forEach((l) => l(item, res));
        emit();
      } catch (e) {
        const cur = items.find((i) => i.id === item.id);
        if (!cur) continue;
        if (e instanceof ApiError && e.status === 401) break; // sessão: tenta depois do novo login
        if (transient(e)) {
          if (e instanceof ApiError && e.status === 0) noteNetworkFail();
          cur.attempts += 1;
          cur.nextAt = Date.now() + Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.min(cur.attempts, 10));
          cur.error = errorMessage(e);
          items = [...items];
          await save();
          emit();
          break; // sem rede: não adianta tentar os próximos
        }
        cur.status = 'failed';
        cur.error = errorMessage(e);
        items = [...items];
        failed++;
        await save();
        emit();
      }
    }
  } finally {
    syncing = false;
    lastSyncAt = Date.now();
    emit();
  }
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Gatilhos: abertura do app, volta da conexão e a cada 30 s enquanto houver pendências
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
function startTimer() {
  if (timer) return;
  timer = setInterval(() => {
    if (!items.some((i) => i.status === 'pending')) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    void syncNow();
  }, PERIOD_MS);
}

let wired = false;
/** Liga os gatilhos de sincronização (uma vez por app). */
export function startOutboxSync() {
  if (wired) return;
  wired = true;
  onConnectivityChange((online) => {
    if (!online) return noteNetworkFail();
    // conexão voltou: tenta já, sem esperar o backoff
    void syncNow(true);
  });
  if (items.some((i) => i.status === 'pending')) startTimer();
  if (deviceOnline()) void syncNow();
}

export function pendingCount(list = items) {
  return list.filter((i) => i.status === 'pending').length;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getSnapshot = () => snapshot;

export function useOutbox() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, pending: pendingCount(s.items), failed: s.items.filter((i) => i.status === 'failed').length };
}
