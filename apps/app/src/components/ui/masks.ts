import { formatCEP, formatCPF, formatPhone, onlyDigits } from '@lendcontrol/core';

export type MaskKind = 'cpf' | 'phone' | 'cep' | 'date' | 'digits' | 'decimal' | 'uf';

export function maskDate(input: string): string {
  const d = onlyDigits(input).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function applyMask(kind: MaskKind | undefined, v: string): string {
  switch (kind) {
    case 'cpf':
      return formatCPF(v);
    case 'phone':
      return formatPhone(v);
    case 'cep':
      return formatCEP(v);
    case 'date':
      return maskDate(v);
    case 'digits':
      return onlyDigits(v);
    case 'decimal':
      return v.replace(/[^\d,.]/g, '').replace('.', ',');
    case 'uf':
      return v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
    default:
      return v;
  }
}

/** Digitação de valor monetário estilo caixa: dígitos -> centavos. */
export function centsFromTyping(v: string): number | null {
  const d = onlyDigits(v).replace(/^0+(?=\d)/, '');
  if (!d) return null;
  return Number(d.slice(0, 13));
}
