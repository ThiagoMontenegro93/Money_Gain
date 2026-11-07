import { describe, expect, it } from 'vitest';
import { classify, collectionStrategies, computeScore, evaluateCreditLock, suggestRateDiscount } from './score';

describe('score', () => {
  it('classificação por faixa', () => {
    expect([10, 8, 7, 5, 4, 2, 1, 0].map(classify)).toEqual(['BOM', 'BOM', 'REGULAR', 'REGULAR', 'RUIM', 'RUIM', 'PERDA', 'PERDA']);
  });

  it('sem histórico começa REGULAR (5)', () => {
    const r = computeScore({ installments: [], today: '2026-11-07' });
    expect(r).toMatchObject({ score: 5, classificacao: 'REGULAR', semHistorico: true, pontualidade: null });
  });

  it('pagamentos em dia somam +2 e saturam em 10', () => {
    const r = computeScore({
      today: '2027-03-01',
      installments: ['2026-11-30', '2026-12-30', '2027-01-30'].map((d) => ({ dueDate: d, status: 'PAGA' as const, paidAt: d })),
    });
    expect(r).toMatchObject({ score: 10, classificacao: 'BOM', pontualidade: 1, onTime: 3 });
  });

  it('atrasos penalizam -1/-2/-3', () => {
    const r = computeScore({
      today: '2027-03-01',
      installments: [
        { dueDate: '2026-11-30', status: 'PAGA', paidAt: '2026-12-03' }, // -1
        { dueDate: '2026-12-30', status: 'PAGA', paidAt: '2027-01-15' }, // -2
        { dueDate: '2027-01-30', status: 'PENDENTE' }, // 30 dias em aberto: -2
      ],
    });
    expect(r.score).toBe(0);
    // sem 6 meses sem pagar não é PERDA: fica RUIM
    expect(r.classificacao).toBe('RUIM');
    expect(r.pontualidade).toBe(0);
  });

  it('checkPerda: > 180 dias sem pagar com parcela vencida => score 0', () => {
    const r = computeScore({
      today: '2027-06-10',
      lastPaymentAt: '2026-12-01',
      installments: [
        { dueDate: '2026-11-30', status: 'PAGA', paidAt: '2026-11-30' },
        { dueDate: '2026-12-30', status: 'PENDENTE', openCents: 250_000 },
      ],
    });
    expect(r.diasSemPagar).toBe(191);
    expect(r).toMatchObject({ isPerda: true, score: 0, classificacao: 'PERDA', openDebtCents: 250_000 });
  });
});

describe('teto por pontualidade', () => {
  it('2 atrasos pequenos em 8 parcelas => REGULAR (7)', () => {
    const inst = Array.from({ length: 8 }, (_, k) => ({ dueDate: `2026-0${1 + (k % 8)}-10`, status: 'PAGA' as const, paidAt: k < 2 ? `2026-0${1 + k}-12` : `2026-0${1 + k}-10` }));
    const r = computeScore({ today: '2026-10-01', installments: inst });
    expect(r).toMatchObject({ score: 7, classificacao: 'REGULAR', pontualidade: 0.75 });
  });
});

describe('trava de crédito', () => {
  it('RUIM gera alerta, PERDA bloqueia', () => {
    expect(evaluateCreditLock({ score: 3, classificacao: 'RUIM', isBlocked: false, pontualidade: 0.4, diasSemPagar: 10, openDebtCents: 0 }))
      .toMatchObject({ level: 'WARNING', title: '⚠️ Cliente RUIM - Score 3/10 - 60% atrasos' });
    expect(evaluateCreditLock({ score: 0, classificacao: 'PERDA', isBlocked: true, pontualidade: 0, diasSemPagar: 180, openDebtCents: 250_000 }).level).toBe('BLOCKED');
    expect(evaluateCreditLock({ score: 9, classificacao: 'BOM', isBlocked: false, pontualidade: 1, diasSemPagar: 0, openDebtCents: 0 }).level).toBe('OK');
  });
});

describe('fidelização e cobrança', () => {
  it('desconto de 10% para 8% economiza R$20/mês em R$1.000', () => {
    expect(suggestRateDiscount(10, 100_000)).toMatchObject({ toRate: 8, monthlySavingsCents: 2_000 });
  });
  it('estratégias PERDA incluem acordo de 30%', () => {
    const s = collectionStrategies('PERDA', 250_000, {}, 180);
    expect(s.find((x) => x.key === 'acordo')!.amountCents).toBe(175_000);
  });
  it('estratégias RUIM: desconto 10% e parcelamento 3x', () => {
    const s = collectionStrategies('RUIM', 100_000, { emergencyName: 'Maria', emergencyPhone: '21977777777' }, 20);
    expect(s.find((x) => x.key === 'desconto')!.amountCents).toBe(90_000);
    expect(s.find((x) => x.key === 'parcelamento')!.amountCents).toBe(35_000);
  });
});
