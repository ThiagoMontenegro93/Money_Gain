/**
 * Score automático 0-10 e classificação BOM / REGULAR / RUIM / PERDA (seção 7).
 */
import { diffDays, ISODate } from './dates';
import { Cents, pct, roundCents } from './money';

export type ClientScoreClass = 'BOM' | 'REGULAR' | 'RUIM' | 'PERDA';

export const SCORE_BASE = 5;
export const PERDA_DAYS = 180;

export interface ScoreInstallment {
  dueDate: ISODate;
  status: 'PENDENTE' | 'PAGA' | 'CANCELADA';
  paidAt?: ISODate | null;
  /** Valor em aberto atualizado (para somar dívida). */
  openCents?: Cents;
}

export interface ScoreInput {
  installments: ScoreInstallment[];
  /** Data do último pagamento aprovado do cliente. */
  lastPaymentAt?: ISODate | null;
  /** Data da liberação do primeiro empréstimo ativo (referência se nunca pagou). */
  firstReleaseAt?: ISODate | null;
  today: ISODate;
}

export interface ScoreResult {
  score: number;
  classificacao: ClientScoreClass;
  /** 0..1 — parcelas pagas em dia / parcelas pagas ou vencidas. null sem histórico. */
  pontualidade: number | null;
  diasSemPagar: number;
  isPerda: boolean;
  semHistorico: boolean;
  onTime: number;
  late1to7: number;
  late8to30: number;
  lateOver30: number;
  overdueOpen: number;
  openDebtCents: Cents;
}

export function latePenalty(daysLate: number): number {
  if (daysLate <= 0) return 2;
  if (daysLate <= 7) return -1;
  if (daysLate <= 30) return -2;
  return -3;
}

export function classify(score: number): ClientScoreClass {
  if (score >= 8) return 'BOM';
  if (score >= 5) return 'REGULAR';
  if (score >= 2) return 'RUIM';
  return 'PERDA';
}

export function computeScore(input: ScoreInput): ScoreResult {
  let score = SCORE_BASE;
  let onTime = 0,
    l7 = 0,
    l30 = 0,
    lMax = 0,
    overdueOpen = 0,
    openDebt = 0;
  for (const i of input.installments) {
    if (i.status === 'CANCELADA') continue;
    let late: number | null = null;
    if (i.status === 'PAGA' && i.paidAt) late = diffDays(i.paidAt, i.dueDate);
    else if (i.status === 'PENDENTE') {
      openDebt += i.openCents ?? 0;
      const d = diffDays(input.today, i.dueDate);
      if (d > 0) {
        late = d;
        overdueOpen++;
      }
    }
    if (late === null) continue;
    score += latePenalty(late);
    if (late <= 0) onTime++;
    else if (late <= 7) l7++;
    else if (late <= 30) l30++;
    else lMax++;
  }
  score = Math.max(0, Math.min(10, Math.round(score)));
  const evaluated = onTime + l7 + l30 + lMax;
  const ref = input.lastPaymentAt ?? input.firstReleaseAt ?? null;
  const diasSemPagar = ref ? Math.max(0, diffDays(input.today, ref)) : 0;
  // checkPerda(): >180 dias sem pagar E parcelas vencidas em aberto => score 0
  const isPerda = overdueOpen > 0 && diasSemPagar > PERDA_DAYS;
  if (isPerda) score = 0;
  return {
    score,
    classificacao: classify(score),
    pontualidade: evaluated ? onTime / evaluated : null,
    diasSemPagar,
    isPerda,
    semHistorico: evaluated === 0,
    onTime,
    late1to7: l7,
    late8to30: l30,
    lateOver30: lMax,
    overdueOpen,
    openDebtCents: openDebt,
  };
}

export const CLASS_META: Record<ClientScoreClass, { label: string; icon: string; color: string; description: string }> = {
  BOM: { label: 'BOM PAGADOR', icon: '⭐', color: '#10B981', description: 'Sempre paga em dia - compromisso alto' },
  REGULAR: { label: 'REGULAR', icon: '🟡', color: '#F59E0B', description: 'Paga com pequenos atrasos' },
  RUIM: { label: 'RUIM', icon: '⚠️', color: '#F97316', description: 'Atrasa sempre - risco alto' },
  PERDA: { label: 'PERDA', icon: '💀', color: '#1F2937', description: '6 meses sem pagamento - categorizado como perda' },
};

// ---------------------------------------------------------------------------
// Trava de crédito
// ---------------------------------------------------------------------------

export type CreditLockLevel = 'OK' | 'WARNING' | 'BLOCKED';

export interface CreditLockInput {
  score: number;
  classificacao: ClientScoreClass;
  isBlocked: boolean;
  pontualidade: number | null;
  diasSemPagar: number;
  openDebtCents: Cents;
}

export function evaluateCreditLock(c: CreditLockInput): { level: CreditLockLevel; title: string; message: string } {
  const brl = (v: Cents) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (c.isBlocked || c.classificacao === 'PERDA') {
    return {
      level: 'BLOCKED',
      title: '🚫 CLIENTE PERDA - BLOQUEADO PARA NOVOS EMPRÉSTIMOS',
      message: `${c.diasSemPagar} dias sem pagamento - Score ${c.score}/10 - ${brl(c.openDebtCents)} em aberto. Só Super Admin pode desbloquear com senha e motivo.`,
    };
  }
  if (c.classificacao === 'RUIM') {
    const atrasos = c.pontualidade === null ? 0 : Math.round((1 - c.pontualidade) * 100);
    return {
      level: 'WARNING',
      title: `⚠️ Cliente RUIM - Score ${c.score}/10 - ${atrasos}% atrasos`,
      message: 'Deseja realmente emprestar? Recomendado: reduzir margem ou aumentar taxa.',
    };
  }
  return { level: 'OK', title: 'Crédito liberado', message: '' };
}

// ---------------------------------------------------------------------------
// Fidelização (cliente BOM)
// ---------------------------------------------------------------------------

export function suggestLimitIncrease(currentLimitCents: Cents, percent = 50) {
  const next = currentLimitCents + pct(currentLimitCents, percent);
  return { fromCents: currentLimitCents, toCents: next, percent };
}

export function suggestRateDiscount(ratePercent: number, principalCents: Cents, relativeDiscount = 20) {
  const newRate = Math.round(ratePercent * (1 - relativeDiscount / 100) * 100) / 100;
  return {
    fromRate: ratePercent,
    toRate: newRate,
    relativeDiscount,
    monthlySavingsCents: pct(principalCents, ratePercent) - pct(principalCents, newRate),
  };
}

// ---------------------------------------------------------------------------
// Estratégias de cobrança (RUIM / PERDA)
// ---------------------------------------------------------------------------

export interface CollectionContact {
  emergencyName?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
  guarantorName?: string | null;
  guarantorPhone?: string | null;
  address?: string | null;
  reference?: string | null;
  residenceTime?: string | null;
}

export interface CollectionStrategy {
  key: string;
  title: string;
  detail: string;
  action?: 'CALL_EMERGENCY' | 'WHATSAPP_GUARANTOR' | 'WA_LINK' | 'PDF_LETTER' | 'NEGATIVATE' | 'LEGAL_DOSSIER' | 'VISIT' | 'OFFER';
  amountCents?: Cents;
}

export function collectionStrategies(
  cls: ClientScoreClass,
  debtCents: Cents,
  c: CollectionContact,
  diasSemPagar: number,
): CollectionStrategy[] {
  const brl = (v: Cents) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const out: CollectionStrategy[] = [];
  if (cls === 'RUIM' || cls === 'REGULAR') {
    if (c.emergencyPhone)
      out.push({ key: 'emergencia', title: 'Contato de emergência', action: 'CALL_EMERGENCY',
        detail: `Ligar para ${c.emergencyName ?? 'contato'}${c.emergencyRelation ? ` (${c.emergencyRelation})` : ''} - ${c.emergencyPhone}` });
    if (c.guarantorPhone)
      out.push({ key: 'fiador', title: 'Acionar fiador', action: 'WHATSAPP_GUARANTOR',
        detail: `Acionar fiador ${c.guarantorName ?? ''} - ${c.guarantorPhone} - ${brl(debtCents)}` });
    if (c.address)
      out.push({ key: 'visita', title: 'Visita', action: 'VISIT',
        detail: `Endereço: ${c.address}${c.reference ? ` - Ponto ref: ${c.reference}` : ''}${c.residenceTime ? ` - Tempo residência ${c.residenceTime}` : ''}` });
    const disc = debtCents - pct(debtCents, 10);
    out.push({ key: 'desconto', title: 'Desconto para quitar hoje', action: 'OFFER', amountCents: disc,
      detail: `Oferecer 10% de desconto para quitar hoje: ${brl(debtCents)} -> ${brl(disc)}` });
    const parcela = roundCents((debtCents * 1.05) / 3);
    out.push({ key: 'parcelamento', title: 'Parcelamento da dívida', action: 'OFFER', amountCents: parcela,
      detail: `Parcelar ${brl(debtCents)} em 3x de ${brl(parcela)}` });
    out.push({ key: 'wa', title: 'Mensagem firme', action: 'WA_LINK', detail: 'Gerar link wa.me com mensagem firme de cobrança' });
  } else if (cls === 'PERDA') {
    out.push({ key: 'carta', title: 'Carta de cobrança extrajudicial', action: 'PDF_LETTER',
      detail: 'Gerar PDF com dados do cliente, valor devido e fiador' });
    out.push({ key: 'negativar', title: 'Negativação', action: 'NEGATIVATE', detail: 'Marcar para negativar' });
    const acordo = debtCents - pct(debtCents, 30);
    out.push({ key: 'acordo', title: 'Acordo com 30% de desconto', action: 'OFFER', amountCents: acordo,
      detail: `Oferecer ${brl(debtCents)} -> ${brl(acordo)} para encerrar (${diasSemPagar} dias sem pagar)` });
    out.push({ key: 'juridico', title: 'Ação legal', action: 'LEGAL_DOSSIER',
      detail: 'Encaminhar para jurídico - gerar dossiê completo com documentos e comprovantes' });
    out.push({ key: 'visita', title: 'Visita presencial com testemunha', action: 'VISIT', detail: c.address ?? 'Endereço não cadastrado' });
  }
  return out;
}
