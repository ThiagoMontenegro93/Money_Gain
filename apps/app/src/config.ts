import { Platform } from 'react-native';
import { kvGet, kvRemove, kvSet } from './offline/kv';

/**
 * URL base da API.
 * - Web: fixa no build (EXPO_PUBLIC_API_URL; na imagem Docker é "/api", mesma origem).
 * - App nativo (APK/iOS): o padrão vem do build, mas o usuário pode trocar o servidor na tela de login
 *   (ex.: http://192.168.0.10:3000/api na rede local ou https://seu-dominio/api). A escolha fica salva no aparelho.
 */
const BUILD_DEFAULT = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
const SERVER_KEY = 'lc.server.url';

let current = BUILD_DEFAULT;
let configured = Platform.OS === 'web' || !/localhost|127\.0\.0\.1/.test(BUILD_DEFAULT);

/** Pode trocar o servidor pelo app? (só no nativo; na web a API é a do próprio site) */
export const SERVER_EDITABLE = Platform.OS !== 'web';

export function getApiUrl(): string {
  return current;
}

/** false enquanto o app nativo ainda aponta para um padrão inútil no celular (localhost). */
export function isServerConfigured(): boolean {
  return configured;
}

/**
 * Normaliza o que o usuário digitou: aceita "192.168.0.10:3000", "meu.dominio.com" ou a URL completa.
 * Sem protocolo: https para domínio, http para IP/rede local. Sem caminho: acrescenta /api.
 * Retorna null se não parecer um endereço válido.
 */
export function normalizeApiUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0];
    const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost' || host.endsWith('.local');
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  const m = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?(\/[^?#]*)?$/i.exec(s);
  if (!m) return null;
  const path = (m[4] ?? '').replace(/\/+$/, '');
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ?? ''}${path || '/api'}`;
}

/** Carrega o servidor salvo no aparelho (chamar antes da primeira requisição). */
export async function loadApiUrl(): Promise<string> {
  if (!SERVER_EDITABLE) return current;
  const saved = await kvGet(SERVER_KEY);
  const norm = saved ? normalizeApiUrl(saved) : null;
  if (norm) {
    current = norm;
    configured = true;
  }
  return current;
}

export async function saveApiUrl(url: string): Promise<void> {
  current = url;
  configured = true;
  await kvSet(SERVER_KEY, url);
}

export async function resetApiUrl(): Promise<void> {
  current = BUILD_DEFAULT;
  configured = Platform.OS === 'web' || !/localhost|127\.0\.0\.1/.test(BUILD_DEFAULT);
  await kvRemove([SERVER_KEY]);
}

/** Testa se o endereço responde como uma API do LendControl (GET /health). */
export async function probeApiUrl(url: string, timeoutMs = 15000): Promise<{ ok: boolean; message: string }> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(`${url}/health`, { headers: { Accept: 'application/json' }, signal: ctrl?.signal });
    if (!r.ok) return { ok: false, message: `O servidor respondeu ${r.status}. Confira o endereço (deve terminar em /api).` };
    const body = (await r.json().catch(() => null)) as { status?: string; version?: string } | null;
    if (!body || typeof body.status !== 'string' || typeof body.version !== 'string') return { ok: false, message: 'Esse endereço não é uma API do LendControl.' };
    return { ok: true, message: 'Servidor encontrado.' };
  } catch {
    return { ok: false, message: 'Não foi possível conectar. Confira o endereço, a rede (Wi-Fi) e se o servidor está ligado.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
