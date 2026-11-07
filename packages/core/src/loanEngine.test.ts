import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  createLoanWithProjection,
  onAmortize,
  onPayInterest,
  onPayQuitacao,
  planPayment,
  priceSchedule,
  quoteLoan,
  simulatePayoff,
  viewInstallment,
} from './loanEngine';
import { addMonthsAnchored } from './dates';

const base = () =>
  createLoanWithProjection({
    type: 'INTEREST_ONLY',
    method: 'MONTHLY',
    principalCents: 100_000,
    ratePercent: 10,
    multaDiaPercent: 1,
    releaseDate: '2026-10-30',
  });

describe('datas', () => {
  it('ancora o dia e limita ao fim do mês', () => {
    expect(addMonthsAnchored('2026-10-30', 1)).toBe('2026-11-30');
    expect(addMonthsAnchored('2026-10-30', 4)).toBe('2027-02-28');
    expect(addMonthsAnchored('2026-10-30', 5)).toBe('2027-03-30');
  });
});

describe('projeção automática (exemplo da especificação)', () => {
  it('R$1.000 em 30/10 a 10% cria quitação 30/11 R$1.100 + 3 projeções de R$100', () => {
    const { installments, loan } = base();
    expect(loan.saldoDevedorCents).toBe(100_000);
    expect(installments.map((i) => [i.number, i.dueDate, i.originalCents, i.type])).toEqual([
      [1, '2026-11-30', 110_000, 'QUITACAO_PREVISTA'],
      [2, '2026-12-30', 10_000, 'PROJECAO_JUROS'],
      [3, '2027-01-30', 10_000, 'PROJECAO_JUROS'],
      [4, '2027-02-28', 10_000, 'PROJECAO_JUROS'],
    ]);
  });

  it('pagar só juros mantém principal, cria 30/03 e mantém 3 futuras', () => {
    const s = base();
    const plan = onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_000, asOf: '2026-11-30' });
    expect(plan.creates.map((c) => c.dueDate)).toEqual(['2027-03-30']);
    expect(plan.allocation).toEqual({ principalCents: 0, interestCents: 10_000, fineCents: 0, extraCents: 0 });
    const next = applyPlan(s.loan, s.installments, plan);
    expect(next.loan.saldoDevedorCents).toBe(100_000);
    const open = next.installments.filter((i) => i.status === 'PENDENTE');
    expect(open).toHaveLength(4);
    expect(open[0]).toMatchObject({ number: 2, type: 'QUITACAO_PREVISTA', originalCents: 110_000, isProjection: false });
    expect(next.installments[0]).toMatchObject({ status: 'PAGA', paidKind: 'JUROS' });
    expect(quoteLoan(next.loan, next.installments, '2026-12-01').nextProjectionDate).toBe('2027-04-30');
  });

  it('loop infinito: 3 pagamentos de juros seguidos sempre mantêm 4 em aberto', () => {
    let s = base();
    for (const d of ['2026-11-30', '2026-12-30', '2027-01-30']) {
      const plan = onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_000, asOf: d });
      s = { ...s, ...applyPlan(s.loan, s.installments, plan) };
    }
    expect(s.installments.filter((i) => i.status === 'PENDENTE').map((i) => i.dueDate)).toEqual([
      '2027-02-28', '2027-03-30', '2027-04-30', '2027-05-30',
    ]);
  });

  it('quitação na parcela 2 remove as 3 projeções e quita (mensagem da especificação)', () => {
    let s = base();
    s = { ...s, ...applyPlan(s.loan, s.installments, onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_000, asOf: '2026-11-30' })) };
    const plan = onPayQuitacao(s.loan, s.installments, { type: 'QUITACAO', amountCents: 110_000, asOf: '2026-12-30', installmentNumber: 2 });
    expect(plan.message).toBe('Quitado em 30/12/2026 - 3 parcelas de projeção removidas');
    expect(plan.allocation).toEqual({ principalCents: 100_000, interestCents: 10_000, fineCents: 0, extraCents: 0 });
    const done = applyPlan(s.loan, s.installments, plan);
    expect(done.loan.status).toBe('QUITADO');
    expect(done.loan.saldoDevedorCents).toBe(0);
    expect(done.installments.filter((i) => i.status === 'CANCELADA')).toHaveLength(3);
    expect(done.installments.filter((i) => i.status === 'PENDENTE')).toHaveLength(0);
    expect(() => onPayInterest(done.loan, done.installments, { type: 'JUROS', amountCents: 10_000, asOf: '2027-01-01' })).toThrow(/não está ativo/);
  });

  it('multa diária: ValorAtual = Parcela * (1 + %multa * dias)', () => {
    const s = base();
    const v = viewInstallment(s.installments[0], s.loan, '2026-12-05'); // 5 dias de atraso
    expect(v.diasAtraso).toBe(5);
    expect(v.updatedCents).toBe(115_500);
    expect(v.interestUpdatedCents).toBe(10_500);
    expect(v.displayStatus).toBe('ATRASADA');
    expect(simulatePayoff(s.loan, s.installments, '2026-12-05')!.amountCents).toBe(115_500);
  });

  it('juros em atraso exigem a multa e não aceitam valor menor', () => {
    const s = base();
    expect(() => onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_000, asOf: '2026-12-05' })).toThrow(/insuficiente/);
    const plan = onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_500, asOf: '2026-12-05' });
    expect(plan.allocation.fineCents).toBe(500);
  });

  it('não permite pagar fora de ordem', () => {
    const s = base();
    expect(() => onPayInterest(s.loan, s.installments, { type: 'JUROS', amountCents: 10_000, asOf: '2026-11-30', installmentNumber: 2 })).toThrow(/parcela 1/);
  });

  it('simular quitação antes do vencimento cobra principal + juros do período', () => {
    const s = base();
    const q = simulatePayoff(s.loan, s.installments, '2026-11-10')!;
    expect(q).toMatchObject({ amountCents: 110_000, principalCents: 100_000, interestCents: 10_000, fineCents: 0, cancelledNumbers: [2, 3, 4] });
  });

  it('quitação com duas parcelas vencidas soma juros e multa de ambas', () => {
    const s = base();
    // 30/12 + 2 dias: parcela 1 com 32 dias e parcela 2 com 2 dias de atraso
    const q = simulatePayoff(s.loan, s.installments, '2027-01-01')!;
    expect(q.coveredNumbers).toEqual([1, 2]);
    expect(q.amountCents).toBe(Math.round(110_000 * 1.32) + Math.round(10_000 * 1.02));
    const plan = onPayQuitacao(s.loan, s.installments, { type: 'QUITACAO', amountCents: q.amountCents, asOf: '2027-01-01' });
    expect(plan.cancelledCount).toBe(2);
  });

  it('amortização reduz saldo e recalcula juros das projeções', () => {
    const s = base();
    const plan = onAmortize(s.loan, s.installments, { type: 'AMORTIZACAO', amountCents: 40_000, asOf: '2026-11-15' });
    const next = applyPlan(s.loan, s.installments, plan);
    expect(next.loan.saldoDevedorCents).toBe(60_000);
    expect(next.installments.map((i) => i.originalCents)).toEqual([66_000, 6_000, 6_000, 6_000]);
    expect(() => onAmortize(s.loan, s.installments, { type: 'AMORTIZACAO', amountCents: 100_000, asOf: '2026-11-15' })).toThrow(/QUITAÇÃO/);
  });
});

describe('outros métodos e Tabela Price', () => {
  it('semanal 5%', () => {
    const s = createLoanWithProjection({ type: 'INTEREST_ONLY', method: 'WEEKLY', principalCents: 50_000, ratePercent: 5, multaDiaPercent: 0, releaseDate: '2026-11-02' });
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(s.installments[0].originalCents).toBe(52_500);
  });

  it('price fecha o saldo exatamente', () => {
    const rows = priceSchedule(100_000, 10, 3);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(100_000);
    expect(rows[0]).toEqual({ principal: 30_211, interest: 10_000 });
  });

  it('price: pagar todas as parcelas quita', () => {
    let s = createLoanWithProjection({ type: 'FIXED_INSTALLMENT', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, multaDiaPercent: 1, releaseDate: '2026-10-30', installmentsCount: 3 });
    for (const i of [...s.installments]) {
      const plan = planPayment(s.loan, s.installments, { type: 'PARCELA', amountCents: i.originalCents, asOf: i.dueDate });
      s = { ...s, ...applyPlan(s.loan, s.installments, plan) };
    }
    expect(s.loan.status).toBe('QUITADO');
    expect(s.loan.saldoDevedorCents).toBe(0);
  });

  it('price: quitação antecipada = saldo + juros do período', () => {
    const s = createLoanWithProjection({ type: 'FIXED_INSTALLMENT', method: 'MONTHLY', principalCents: 100_000, ratePercent: 10, multaDiaPercent: 1, releaseDate: '2026-10-30', installmentsCount: 3 });
    expect(simulatePayoff(s.loan, s.installments, '2026-11-05')!.amountCents).toBe(110_000);
  });

  it('valida entrada', () => {
    expect(() => createLoanWithProjection({ type: 'FIXED_INSTALLMENT', method: 'MONTHLY', principalCents: 1000, ratePercent: 1, multaDiaPercent: 0, releaseDate: '2026-10-30' })).toThrow(/parcelas/);
    expect(() => createLoanWithProjection({ type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 0, ratePercent: 1, multaDiaPercent: 0, releaseDate: '2026-10-30' })).toThrow(/principal/);
  });
});
