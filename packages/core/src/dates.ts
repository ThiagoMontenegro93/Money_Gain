/**
 * Datas "somente dia" no formato ISO (YYYY-MM-DD).
 * Todo o motor trabalha com strings ISO para evitar problemas de fuso horário.
 */
export type ISODate = string;

export const BUSINESS_TZ = 'America/Sao_Paulo';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISO(d: ISODate): { y: number; m: number; day: number } {
  const match = ISO_RE.exec(d);
  if (!match) throw new Error(`Data inválida: ${d} (esperado YYYY-MM-DD)`);
  return { y: Number(match[1]), m: Number(match[2]), day: Number(match[3]) };
}

export function toISO(y: number, m: number, day: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidISODate(d: string): boolean {
  if (!ISO_RE.test(d)) return false;
  const { y, m, day } = parseISO(d);
  return m >= 1 && m <= 12 && day >= 1 && day <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toUTC(d: ISODate): number {
  const { y, m, day } = parseISO(d);
  return Date.UTC(y, m - 1, day);
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = new Date(toUTC(d) + n * 86_400_000);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Soma meses ancorando no dia original e limitando ao último dia do mês
 * (30/10 + 4 meses = 28/02; + 5 meses = 30/03).
 */
export function addMonthsAnchored(d: ISODate, n: number): ISODate {
  const { y, m, day } = parseISO(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

/** Diferença em dias (a - b). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

/** "Hoje" no fuso do negócio (America/Sao_Paulo). */
export function todayISO(now: Date = new Date(), tz: string = BUSINESS_TZ): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Converte Date (UTC meia-noite, como o Prisma devolve @db.Date) em ISO. */
export function dateToISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function isoToDate(d: ISODate): Date {
  return new Date(toUTC(d));
}

/** DD/MM/AAAA -> ISO. Retorna null se inválida. */
export function brDateToISO(br: string): ISODate | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(br.trim());
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y > 30 ? 1900 : 2000;
  const iso = toISO(y, Number(m[2]), Number(m[1]));
  return isValidISODate(iso) ? iso : null;
}

export function isoToBR(d: ISODate): string {
  const { y, m, day } = parseISO(d);
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function ageFrom(birth: ISODate, today: ISODate): number {
  const b = parseISO(birth);
  const t = parseISO(today);
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.day < b.day)) age--;
  return age;
}
