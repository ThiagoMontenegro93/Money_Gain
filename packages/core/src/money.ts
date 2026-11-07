/** Valores monetários são sempre inteiros em centavos dentro do motor. */
export type Cents = number;

export function toCents(value: number | string | { toString(): string }): Cents {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Valor monetário inválido: ${String(value)}`);
  return Math.round(n * 100);
}

export function fromCents(c: Cents): number {
  return Math.round(c) / 100;
}

/** Arredondamento "half up" de produtos em centavos. */
export function roundCents(n: number): Cents {
  return Math.round(n + Number.EPSILON * Math.sign(n));
}

export function pct(base: Cents, percent: number): Cents {
  return roundCents((base * percent) / 100);
}

export function formatBRL(c: Cents): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(c)).replace(/\u00a0/g, ' ');
}

/** "R$ 1.234,56" / "1234,56" / "1234.56" -> centavos. */
export function parseBRL(input: string): Cents | null {
  const s = input.replace(/[R$\s]/g, '');
  if (!s) return null;
  let normalized = s;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  // "2.500" / "1.200.000" sem vírgula: ponto é separador de milhar (padrão brasileiro)
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? toCents(n) : null;
}
