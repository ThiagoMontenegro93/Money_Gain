import { API_URL } from '../config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function messageFrom(body: unknown, status: number): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; code?: unknown; error?: unknown };
    const msg = Array.isArray(b.message) ? b.message.join('; ') : typeof b.message === 'string' ? b.message : null;
    if (msg) return { message: msg, code: typeof b.code === 'string' ? b.code : undefined };
  }
  if (status === 401) return { message: 'Sessão expirada. Faça login novamente.' };
  if (status === 403) return { message: 'Você não tem permissão para esta ação.' };
  if (status === 404) return { message: 'Registro não encontrado.' };
  return { message: `Erro ${status} ao comunicar com o servidor.` };
}

/**
 * Um 401 de regra de negócio (ex.: "Senha incorreta" na reconfirmação, "não pode desativar a si mesmo")
 * não deve derrubar a sessão: só desloga se o próprio token for recusado em /auth/me.
 */
async function confirmSessionLost(path: string) {
  const token = authToken;
  if (path === '/auth/me') return onUnauthorized?.();
  try {
    const r = await fetch(`${API_URL}/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (r.status === 401 && token === authToken) onUnauthorized?.();
  } catch {
    /* sem rede: mantém a sessão */
  }
}

export async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form as unknown as BodyInit;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${buildQuery(opts.query)}`, { method, headers, body });
  } catch {
    throw new ApiError(0, `Não foi possível conectar à API (${API_URL}). Verifique se o servidor está no ar.`);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const { message, code } = messageFrom(data, res.status);
    if (res.status === 401 && authToken && onUnauthorized) void confirmSessionLost(path);
    throw new ApiError(res.status, message, code);
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};

/** Baixa um arquivo autenticado (ex.: PDF) como Blob. */
export async function fetchBlob(path: string, init: { method?: string; body?: unknown } = {}): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError(0, `Não foi possível conectar à API (${API_URL}). Verifique se o servidor está no ar.`);
  }
  if (!res.ok) {
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* texto puro */
    }
    const { message, code } = messageFrom(data, res.status);
    throw new ApiError(res.status, message, code);
  }
  return res.blob();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Erro inesperado';
}
