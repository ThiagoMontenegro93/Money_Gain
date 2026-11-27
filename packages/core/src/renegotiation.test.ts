import { describe, expect, it } from 'vitest';
import { createLoanWithProjection, planPayment, simulatePayoff } from './loanEngine';
import { planRenegotiation } from './renegotiation';
import { simulateLoanChanges } from './simulation';

const late = () =>
  createLoanWithProjection({ type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 2_000_000, ratePercent: 10, multaDiaPercent: 1, releaseDate: '2026-06-01' });

describe('negociação emergencial', () => {
  it('dívida de R$ 20 mil vira acordo de R$ 5 mil em 5x: prejuízo e desconto calculados', () => {
    const s = late();
    const asOf = '2026-11-27';
    const debt = simulatePayoff(s.loan, s.installments, asOf)!.amountCents;
    const p = planRenegotiation(s.loan, s.installments, { agreedCents: 500_000, installmentsCount: 5, method: 'MONTHLY', firstDueDate: '2026-12-27', asOf });
    expect(p.debtCents).toBe(debt);
    expect(p.principalCents).toBe(500_000);
    expect(p.writeOffCents).toBe(1_500_000);
    expect(p.discountCents).toBe(debt - 500_000);
    expect(p.revenueCents).toBe(0);
    expect(p.installments.map((i) => [i.dueDate, i.originalCents])).toEqual([
      ['2026-12-27', 100_000],
      ['2027-01-27', 100_000],
      ['2027-02-27', 100_000],
      ['2027-03-27', 100_000],
      ['2027-04-27', 100_000],
    ]);
    expect(p.loan).toMatchObject({ type: 'FIXED_INSTALLMENT', saldoDevedorCents: 500_000, ratePercent: 0, allowAmortization: false, allowLateFee: false });
    // pagar a 1ª parcela abate só principal
    const pay = planPayment(p.loan, p.installments, { type: 'PARCELA', amountCents: 100_000, asOf: '2026-12-27' });
    expect(pay.allocation).toMatchObject({ principalCents: 100_000, interestCents: 0, fineCents: 0 });
  });

  it('acordo acima do saldo devedor: devolve todo o capital e o resto é receita', () => {
    const s = late();
    const p = planRenegotiation(s.loan, s.installments, { agreedCents: 3_000_000, installmentsCount: 3, method: 'WEEKLY', firstDueDate: '2026-11-30', asOf: '2026-11-27' });
    expect(p.writeOffCents).toBe(0);
    expect(p.revenueCents).toBe(1_000_000);
    expect(p.installments.reduce((s2, i) => s2 + i.principalCents, 0)).toBe(2_000_000);
    expect(p.installments.reduce((s2, i) => s2 + i.originalCents, 0)).toBe(3_000_000);
    expect(p.installments.every((i) => i.interestCents >= 0)).toBe(true);
    expect(p.installments[2].dueDate).toBe('2026-12-14');
  });

  it('valores quebrados: soma bate e nenhuma parcela tem juros negativo', () => {
    const s = late();
    const p = planRenegotiation(s.loan, s.installments, { agreedCents: 2_000_011, installmentsCount: 7, method: 'DAILY', firstDueDate: '2026-11-28', asOf: '2026-11-27' });
    expect(p.installments.reduce((a, i) => a + i.originalCents, 0)).toBe(2_000_011);
    expect(p.installments.reduce((a, i) => a + i.principalCents, 0)).toBe(2_000_000);
    expect(p.installments.every((i) => i.interestCents >= 0 && i.principalCents >= 0)).toBe(true);
  });

  it('validações', () => {
    const s = late();
    const base = { agreedCents: 100, installmentsCount: 1, method: 'MONTHLY' as const, firstDueDate: '2026-12-01', asOf: '2026-11-27' };
    expect(() => planRenegotiation(s.loan, s.installments, { ...base, agreedCents: 0 })).toThrow(/valor/);
    expect(() => planRenegotiation(s.loan, s.installments, { ...base, firstDueDate: '2026-11-01' })).toThrow(/passado/);
    expect(() => planRenegotiation({ ...s.loan, status: 'QUITADO' }, s.installments, base)).toThrow(/ativos/);
  });
});

describe('simulação de mudanças (sem gravar)', () => {
  it('compara antes e depois ao ligar o atraso longo e perdoar a multa', () => {
    const s = late();
    const asOf = '2026-11-27';
    const r = simulateLoanChanges(s.loan, s.installments, { longLateMode: 'FIXED', longLateAfterDays: 60, longLateFixedCents: 1_000 }, asOf);
    expect(r.before.longLateCents).toBe(0);
    expect(r.after.longLateCents).toBeGreaterThan(0);
    expect(r.diffPayoffCents).toBe(r.after.longLateCents);
    const w = simulateLoanChanges(s.loan, s.installments, { allowLateFee: false }, asOf);
    expect(w.after.fineCents).toBe(0);
    expect(w.diffPayoffCents).toBe(-w.before.fineCents);
    expect(s.loan.allowLateFee).toBe(true); // nada foi alterado no original
  });

  it('nova taxa muda só os juros que ainda não venceram', () => {
    const s = createLoanWithProjection({ type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, multaDiaPercent: 1, releaseDate: '2026-11-20' });
    const r = simulateLoanChanges(s.loan, s.installments, { ratePercent: 15 }, '2026-11-27');
    expect(r.before.payoffCents).toBe(110_000);
    expect(r.after.payoffCents).toBe(115_000);
    expect(() => simulateLoanChanges(s.loan, s.installments, { longLateMode: 'PERCENT', longLatePercent: 0 }, '2026-11-27')).toThrow();
  });
});
