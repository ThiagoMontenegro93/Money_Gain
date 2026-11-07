import { Prisma } from '@prisma/client';
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { dateToISO, isoToDate, ISODate, todayISO } from '@lendcontrol/core';
import { ZodSchema } from 'zod';

/** Decimal (Prisma) -> centavos inteiros. */
export function c(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Math.round(Number(v.toString()) * 100);
}
export function cn(v: Prisma.Decimal | null | undefined): number | null {
  return v === null || v === undefined ? null : c(v);
}
/** centavos -> Decimal */
export function d(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}
export function num(v: Prisma.Decimal | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v.toString());
}
export const iso = (dt: Date | null | undefined): ISODate | null => (dt ? dateToISO(dt) : null);
export const dt = (s: ISODate): Date => isoToDate(s);
export const today = (): ISODate => todayISO();

export class ZodPipe<T> implements PipeTransform {
  constructor(private schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      throw new BadRequestException({ message: msg, code: 'VALIDATION' });
    }
    return r.data;
  }
}

export function ref<T extends { id: string; name: string } | null | undefined>(u: T) {
  return u ? { id: u.id, name: u.name } : null;
}
