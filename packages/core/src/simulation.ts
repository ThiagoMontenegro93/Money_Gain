/**
 * Simulação "e se?": aplica mudanças de teste nas opções de um empréstimo e compara o antes e o depois,
 * sem gravar nada. Usada antes de valer de verdade no sistema.
 */
import { ISODate } from './dates';
import { Cents } from './money';
import { EngineInstallment, EngineLoan, openInstallments, quoteLoan, validateLongLate, viewInstallment } from './loanEngine';

export type LoanChanges = Partial<
  Pick<EngineLoan, 'ratePercent' | 'multaDiaPercent' | 'allowLateFee' | 'allowAmortization' | 'longLateMode' | 'longLateAfterDays' | 'longLatePercent' | 'longLateFixedCents'>
>;

export interface SimulationSide {
  payoffCents: Cents;
  fineCents: Cents;
  longLateCents: Cents;
  nextValueCents: Cents | null;
  interestOnlyCents: Cents | null;
  installments: { number: number; dueDate: ISODate; diasAtraso: number; updatedCents: Cents; longLateCents: Cents }[];
}

export interface SimulationResult {
  asOf: ISODate;
  before: SimulationSide;
  after: SimulationSide;
  /** Diferença na quitação (depois - antes). */
  diffPayoffCents: Cents;
}

function side(loan: EngineLoan, inst: EngineInstallment[], asOf: ISODate): SimulationSide {
  const q = quoteLoan(loan, inst, asOf);
  return {
    payoffCents: q.payoff?.amountCents ?? 0,
    fineCents: q.payoff?.fineCents ?? 0,
    longLateCents: q.payoff?.longLateCents ?? 0,
    nextValueCents: q.next?.updatedCents ?? null,
    interestOnlyCents: q.interestOnlyCents,
    installments: openInstallments(inst).map((i) => {
      const v = viewInstallment(i, loan, asOf);
      return { number: v.number, dueDate: v.dueDate, diasAtraso: v.diasAtraso, updatedCents: v.updatedCents, longLateCents: v.longLateCents };
    }),
  };
}

/**
 * A taxa nova vale para os juros ainda não vencidos (parcelas em aberto sem atraso), como seria numa troca real
 * de condições; as parcelas já vencidas mantêm o valor combinado.
 */
export function simulateLoanChanges(loan: EngineLoan, installments: EngineInstallment[], changes: LoanChanges, asOf: ISODate): SimulationResult {
  const next: EngineLoan = { ...loan, ...changes };
  if (changes.allowLateFee === false) next.multaDiaPercent = loan.multaDiaPercent;
  validateLongLate(next);
  let inst = installments;
  if (changes.ratePercent !== undefined && changes.ratePercent !== loan.ratePercent && loan.type === 'INTEREST_ONLY') {
    const interest = Math.round((loan.saldoDevedorCents * changes.ratePercent) / 100);
    inst = installments.map((i) =>
      i.status === 'PENDENTE' && i.dueDate >= asOf ? { ...i, interestCents: interest, originalCents: i.principalCents + interest } : i,
    );
  }
  const before = side(loan, installments, asOf);
  const after = side(next, inst, asOf);
  return { asOf, before, after, diffPayoffCents: after.payoffCents - before.payoffCents };
}
