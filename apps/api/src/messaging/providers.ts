import { normalizePhone } from '@lendcontrol/core';

export type ProviderName = 'EVOLUTION' | 'META' | 'LINK';

export interface WhatsAppConfig {
  enabled: boolean;
  provider: ProviderName;
  /** Evolution API / Z-API (QR code) */
  baseUrl: string;
  instance: string;
  apiKeyEnc: string | null;
  /** Meta Cloud API oficial */
  metaPhoneNumberId: string;
  metaTokenEnc: string | null;
  windowStart: string;
  windowEnd: string;
  sendTime: string;
  autoPaymentOk: boolean;
  notifyGuarantorD7: boolean;
  /** Telefones que nunca recebem mensagens automáticas */
  blacklist: string[];
}

export const DEFAULT_WA_CONFIG: WhatsAppConfig = {
  enabled: false,
  provider: 'LINK',
  baseUrl: '',
  instance: '',
  apiKeyEnc: null,
  metaPhoneNumberId: '',
  metaTokenEnc: null,
  windowStart: '08:00',
  windowEnd: '20:00',
  sendTime: '09:00',
  autoPaymentOk: true,
  notifyGuarantorD7: true,
  blacklist: [],
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

const intl = (phone: string) => `55${normalizePhone(phone)}`;

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status >= 500 || res.status === 429);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`Falha de rede: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Envia texto pelo provedor configurado. Retorna o id da mensagem no provedor.
 * - Evolution API v2: POST {baseUrl}/message/sendText/{instance}  header apikey  body {number, text}
 * - Meta Cloud API:   POST graph.facebook.com/v21.0/{phoneNumberId}/messages (fora da janela de 24h a Meta exige template aprovado)
 */
export async function sendViaProvider(cfg: WhatsAppConfig, secrets: { apiKey?: string; metaToken?: string }, phone: string, text: string): Promise<string | null> {
  if (cfg.provider === 'EVOLUTION') {
    if (!cfg.baseUrl || !cfg.instance || !secrets.apiKey) throw new ProviderError('Evolution API não configurada (URL, instância e API key)', false);
    const r = await post(`${cfg.baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(cfg.instance)}`, { apikey: secrets.apiKey }, { number: intl(phone), text });
    const key = r.key as { id?: string } | undefined;
    return key?.id ?? (r.id as string | undefined) ?? null;
  }
  if (cfg.provider === 'META') {
    if (!cfg.metaPhoneNumberId || !secrets.metaToken) throw new ProviderError('Meta Cloud API não configurada (Phone Number ID e token)', false);
    const r = await post(`https://graph.facebook.com/v21.0/${cfg.metaPhoneNumberId}/messages`, { authorization: `Bearer ${secrets.metaToken}` }, {
      messaging_product: 'whatsapp',
      to: intl(phone),
      type: 'text',
      text: { body: text },
    });
    return ((r.messages as { id: string }[] | undefined)?.[0]?.id) ?? null;
  }
  throw new ProviderError('Canal manual (link wa.me)', false);
}
