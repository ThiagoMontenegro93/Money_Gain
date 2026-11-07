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

export const MESSAGE_STATUS_LABEL: Record<string, string> = {
  PENDENTE: 'Na fila',
  ENVIADO: 'Enviado',
  FALHOU: 'Falhou',
  LINK_GERADO: 'Link wa.me',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
};

export const MESSAGE_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  PENDENTE: { bg: '#B45309', color: '#FFFFFF' },
  ENVIADO: { bg: '#059669', color: '#FFFFFF' },
  FALHOU: { bg: '#B91C1C', color: '#FFFFFF' },
  LINK_GERADO: { bg: '#1D4ED8', color: '#FFFFFF' },
  BLOQUEADO: { bg: '#374151', color: '#E5E7EB' },
  CANCELADO: { bg: '#374151', color: '#E5E7EB' },
};

export const TEMPLATE_LABEL_EXTRA: Record<string, string> = { TESTE: 'Teste' };

export const DOCUMENT_TYPES: { value: string; label: string; icon: string }[] = [
  { value: 'RG', label: 'RG', icon: '🪪' },
  { value: 'CPF', label: 'CPF', icon: '🪪' },
  { value: 'COMPROVANTE_RESIDENCIA', label: 'Comprovante de residência', icon: '🏠' },
  { value: 'COMPROVANTE_RENDA', label: 'Comprovante de renda', icon: '💼' },
  { value: 'SELFIE', label: 'Selfie', icon: '🤳' },
  { value: 'CONTRATO', label: 'Contrato assinado', icon: '📝' },
  { value: 'FIADOR_FOTO', label: 'Documento do fiador', icon: '🤝' },
  { value: 'COMPROVANTE_PAGAMENTO_CLIENTE', label: 'Comprovante de pagamento', icon: '🧾' },
];

export const DOC_STATUS_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  VERIFICADO: { bg: '#059669', color: '#FFFFFF', label: '✓ Verificado' },
  PENDENTE: { bg: '#D97706', color: '#FFFFFF', label: '⏳ Pendente' },
  VENCIDO: { bg: '#B91C1C', color: '#FFFFFF', label: '⚠ Vencido' },
};

export const WA_PROVIDER_LABEL: Record<string, string> = {
  EVOLUTION: 'Evolution API (QR code)',
  META: 'Meta Cloud API (oficial)',
  LINK: 'Só link wa.me (manual)',
};
