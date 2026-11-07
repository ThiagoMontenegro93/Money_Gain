/**
 * Mensagens WhatsApp pré-programadas (seção 4): templates, variáveis e janela de envio.
 */
import { diffDays, ISODate } from './dates';

export type TemplateKey =
  | 'D_MINUS_2'
  | 'D_0'
  | 'D_PLUS_1'
  | 'D_PLUS_3'
  | 'D_PLUS_7'
  | 'D_PLUS_7_FIADOR'
  | 'PAYMENT_OK'
  | 'COBRANCA_FIRME';

export const TEMPLATE_VARS = ['nome', 'valor', 'vencimento', 'valor_atualizado', 'dias_atraso', 'pix_chave', 'fiador_nome'] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARS)[number], string>>;

export const TEMPLATE_META: Record<TemplateKey, { label: string; when: string }> = {
  D_MINUS_2: { label: 'Lembrete D-2', when: '2 dias antes do vencimento' },
  D_0: { label: 'Vence hoje (D0)', when: 'no dia do vencimento' },
  D_PLUS_1: { label: 'Atraso D+1', when: '1 dia após o vencimento' },
  D_PLUS_3: { label: 'Atraso D+3', when: '3 dias após o vencimento' },
  D_PLUS_7: { label: 'Atraso D+7 (cliente)', when: '7 dias após o vencimento' },
  D_PLUS_7_FIADOR: { label: 'Atraso D+7 (fiador)', when: '7 dias após o vencimento, para o fiador' },
  PAYMENT_OK: { label: 'Pagamento confirmado', when: 'quando o pagamento é aprovado' },
  COBRANCA_FIRME: { label: 'Cobrança firme (manual)', when: 'enviada manualmente pela tela de cobrança' },
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  D_MINUS_2:
    'Olá {nome}! Lembrete: sua parcela de {valor} vence em {vencimento}. Chave PIX para pagamento: {pix_chave}. Qualquer dúvida, estou à disposição.',
  D_0: 'Bom dia, {nome}! Sua parcela de {valor} vence HOJE ({vencimento}). PIX: {pix_chave}. Após pagar, envie o comprovante por aqui. Obrigado!',
  D_PLUS_1:
    '{nome}, não identificamos o pagamento da parcela vencida em {vencimento}. Valor atualizado: {valor_atualizado} ({dias_atraso} dia de atraso). PIX: {pix_chave}.',
  D_PLUS_3:
    '{nome}, sua parcela está em atraso há {dias_atraso} dias. Valor atualizado com multa: {valor_atualizado}. Regularize hoje para evitar novos acréscimos. PIX: {pix_chave}.',
  D_PLUS_7:
    '{nome}, sua parcela vencida em {vencimento} está com {dias_atraso} dias de atraso. Valor atualizado: {valor_atualizado}. Entre em contato hoje para regularizar. Seu fiador {fiador_nome} também será comunicado.',
  D_PLUS_7_FIADOR:
    'Olá {fiador_nome}. Você é fiador(a) de {nome}, que está com uma parcela em atraso há {dias_atraso} dias (valor atualizado {valor_atualizado}). Pedimos sua ajuda para regularizar. PIX: {pix_chave}.',
  PAYMENT_OK: 'Olá {nome}! Confirmamos o recebimento do seu pagamento de {valor}. Obrigado pela pontualidade!',
  COBRANCA_FIRME:
    '{nome}, sua dívida de {valor_atualizado} está em atraso há {dias_atraso} dias. Esta é uma cobrança formal: regularize em até 48 horas para evitar a adoção de medidas de cobrança. PIX: {pix_chave}.',
};

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? '').replace(/\s{2,}/g, ' ').trim();
}

/** Template automático para a parcela, conforme dias até/depois do vencimento. */
export function templateForDue(dueDate: ISODate, today: ISODate): TemplateKey[] {
  const d = diffDays(today, dueDate); // >0 atrasado
  if (d === -2) return ['D_MINUS_2'];
  if (d === 0) return ['D_0'];
  if (d === 1) return ['D_PLUS_1'];
  if (d === 3) return ['D_PLUS_3'];
  if (d === 7) return ['D_PLUS_7', 'D_PLUS_7_FIADOR'];
  return [];
}

function minutesInTz(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Respeita a janela 08:00-20:00 (fuso do negócio). */
export function isWithinWindow(now: Date, start = '08:00', end = '20:00', tz = 'America/Sao_Paulo'): boolean {
  const m = minutesInTz(now, tz);
  return m >= toMin(start) && m < toMin(end);
}

/** Milissegundos até a próxima abertura da janela (0 se já está dentro). */
export function msUntilWindow(now: Date, start = '08:00', end = '20:00', tz = 'America/Sao_Paulo'): number {
  if (isWithinWindow(now, start, end, tz)) return 0;
  const m = minutesInTz(now, tz);
  const s = toMin(start);
  const wait = m < s ? s - m : 24 * 60 - m + s;
  return wait * 60_000 - now.getUTCSeconds() * 1000;
}
