import { formatBRL, isoToBR } from '@lendcontrol/core';

export const brl = (c: number | null | undefined) => (c == null ? '—' : formatBRL(c));

export function dateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.slice(0, 10);
  try {
    return isoToBR(d);
  } catch {
    return iso;
  }
}

export function dateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const pctText = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** "10,5" -> 10.5 ; vazio -> null */
export function parseDecimal(s: string): number | null {
  const t = s.replace(/\s|%/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const decimalText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  JUROS: 'Só Juros',
  QUITACAO: 'Quitação',
  AMORTIZACAO: 'Amortização',
  PARCELA: 'Parcela',
};

export const APPROVAL_LABEL: Record<string, string> = {
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
};

export const TRANSFER_LABEL: Record<string, string> = {
  REPASSE_CAPITAL: 'Repasse de capital (Dono → Funcionário)',
  REPASSE_LUCRO: 'Repasse para o Dono',
  DEVOLUCAO_CAPITAL: 'Devolução de capital',
  PAGAMENTO_COMISSAO: 'Pagamento de comissão',
};

export const LOAN_TYPE_LABEL: Record<string, string> = {
  INTEREST_ONLY: 'Juros c/ projeção automática',
  FIXED_INSTALLMENT: 'Parcela fixa (Price)',
};

export const LOAN_STATUS_LABEL: Record<string, string> = { ATIVO: 'Ativo', QUITADO: 'Quitado', PERDA: 'Perda', CANCELADO: 'Cancelado' };
export const CLIENT_STATUS_LABEL: Record<string, string> = { RASCUNHO: 'Rascunho', ATIVO: 'Ativo', INATIVO: 'Inativo' };
