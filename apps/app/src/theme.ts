import type { ClientScoreClass } from '@lendcontrol/core';

/** Paleta central do LendControl Pro (tema escuro + inputs de alta visibilidade - seção 11). */
export const colors = {
  bg: '#0F172A',
  surface: '#1E293B',
  surface2: '#273449',
  border: '#334155',
  borderStrong: '#475569',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  label: '#E2E8F0',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  success: '#10B981',
  successDark: '#059669',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerDark: '#B91C1C',
  orange: '#F97316',
  info: '#38BDF8',
  gray: '#6B7280',
  // Inputs de alta visibilidade
  inputBg: '#FFFFFF',
  inputText: '#0F172A',
  inputPlaceholder: '#475569',
  inputBorder: '#CBD5E1',
  inputFocus: '#3B82F6',
  inputDisabled: '#E2E8F0',
  required: '#EF4444',
};

/** Linhas da lista de clientes coloridas por classificação (seção 7 - Tailwind). */
export const classRow: Record<ClientScoreClass, { bg: string; border: string; text: string; textMuted: string }> = {
  BOM: { bg: '#ECFDF5', border: '#10B981', text: '#064E3B', textMuted: '#047857' }, // emerald-50 / emerald-500
  REGULAR: { bg: '#FFFBEB', border: '#FBBF24', text: '#78350F', textMuted: '#92400E' }, // amber-50 / amber-400
  RUIM: { bg: '#FFEDD5', border: '#F97316', text: '#7C2D12', textMuted: '#9A3412' }, // orange-100 / orange-500 / orange-900
  PERDA: { bg: '#E5E7EB', border: '#1F2937', text: '#1F2937', textMuted: '#374151' }, // gray-200 / gray-800
};

/** Faixa grande do detalhe do cliente. */
export const classBand: Record<ClientScoreClass, { bg: string; text: string; border: string }> = {
  BOM: { bg: '#059669', text: '#FFFFFF', border: '#10B981' },
  REGULAR: { bg: '#D97706', text: '#FFFFFF', border: '#FBBF24' },
  RUIM: { bg: '#C2410C', text: '#FFFFFF', border: '#EF4444' },
  PERDA: { bg: '#030712', text: '#FFFFFF', border: '#EF4444' },
};

export const classColor: Record<ClientScoreClass, string> = {
  BOM: '#10B981',
  REGULAR: '#F59E0B',
  RUIM: '#F97316',
  PERDA: '#6B7280',
};

export const classIcon: Record<ClientScoreClass, string> = { BOM: '⭐', REGULAR: '🟡', RUIM: '⚠️', PERDA: '💀' };
export const classLabel: Record<ClientScoreClass, string> = { BOM: 'Bom', REGULAR: 'Regular', RUIM: 'Ruim', PERDA: 'Perda' };

/** Cor do score interno 0-10: 0-3 vermelho, 4-7 amarelo, 8-10 verde. */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return colors.textDim;
  if (score <= 3) return colors.danger;
  if (score <= 7) return colors.warning;
  return colors.success;
}

export const radius = { sm: 6, md: 10, lg: 14 };
export const space = (n: number) => n * 4;

export const BREAKPOINT_DESKTOP = 1024;
