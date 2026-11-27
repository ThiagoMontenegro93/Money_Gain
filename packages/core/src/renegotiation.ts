/**
 * Negociação emergencial: o cliente não consegue pagar a dívida toda e propõe um valor menor (ou parcelado).
 * O empréstimo antigo é encerrado como RENEGOCIADO e nasce um acordo em parcelas fixas, sem juros novos.
 *
 * Contabilidade do acordo:
 *  - Recupera primeiro o capital (principal): principal do acordo = min(valor acordado, saldo devedor).
 *  - O que passar do saldo devedor é receita (juros/multa negociados).
 *  - Prejuízo de capital = saldo devedor - principal do acordo (dinheiro que não volta).
 *  - Desconto concedido = dívida atualizada de hoje - valor acordado.
 */
import { addDays, addMonthsAnchored, diffDays, ISODate, isValidISODate } from './dates';
import { Cents } from './money';
import { EngineInstallment, EngineLoan, LoanEngineError, LoanMethod, simulatePayoff } from './loanEngine';

export interface RenegotiationInput {
  agreedCents: Cents;
  installmentsCount: number;
  method: LoanMethod;
  firstDueDate: ISODate;
  /** Data do acordo (hoje). */
  asOf: ISODate;
  allowLateFee?: boolean;
  multaDiaPercent?: number;
}

export interface RenegotiationPlan {
  /** Dívida atualizada na data do acordo (saldo + juros + multas). */
  debtCents: Cents;
  saldoDevedorCents: Cents;
  agreedCents: Cents;
  /** Parte do acordo que devolve capital. */
  principalCents: Cents;
  /** Parte do acordo acima do saldo devedor (receita). */
  revenueCents: Cents;
  /** Capital que não volta (saldo devedor - principal do acordo). */
  writeOffCents: Cents;
  /** Quanto da dívida foi perdoado (dívida - acordo, nunca negativo). */
  discountCents: Cents;
  /** % da dívida que será recuperada. */
  recoveryPercent: number;
  loan: EngineLoan;
  installments: EngineInstallment[];
  dueDate: ISODate;
}

export function renegDueDate(first: ISODate, method: LoanMethod, k: number): ISODate {
  if (k === 0) return first;
  switch (method) {
    case 'DAILY':
      return addDays(first, k);
    case 'WEEKLY':
      return addDays(first, 7 * k);
    case 'BIWEEKLY':
      return addDays(first, 14 * k);
    case 'MONTHLY':
      return addMonthsAnchored(first, k);
  }
}

export function planRenegotiation(loan: EngineLoan, installments: EngineInstallment[], input: RenegotiationInput): RenegotiationPlan {
  if (loan.status !== 'ATIVO' && loan.status !== 'PERDA')
    throw new LoanEngineError('NOT_ACTIVE', 'Só empréstimos ativos ou em perda podem ser renegociados');
  if (!Number.isInteger(input.agreedCents) || input.agreedCents <= 0)
    throw new LoanEngineError('INVALID_AGREED', 'Informe o valor que o cliente vai pagar no acordo');
  const n = input.installmentsCount;
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new LoanEngineError('INVALID_COUNT', 'Número de parcelas entre 1 e 360');
  if (!isValidISODate(input.firstDueDate)) throw new LoanEngineError('INVALID_DATE', 'Data da 1ª parcela inválida');
  if (diffDays(input.firstDueDate, input.asOf) < 0) throw new LoanEngineError('INVALID_DATE', 'A 1ª parcela do acordo não pode ser no passado');
  const fine = input.allowLateFee ? (input.multaDiaPercent ?? 0) : 0;
  if (!(fine >= 0) || fine > 100) throw new LoanEngineError('INVALID_FINE', 'Multa diária deve estar entre 0% e 100%');

  const debt = simulatePayoff(loan, installments, input.asOf)?.amountCents ?? loan.saldoDevedorCents;
  const saldo = loan.saldoDevedorCents;
  const agreed = input.agreedCents;
  const principal = Math.min(agreed, saldo);

  // Parcelas iguais (a última ajusta o arredondamento); principal distribuído proporcionalmente.
  const base = Math.floor(agreed / n);
  const out: EngineInstallment[] = [];
  let cumValue = 0;
  let cumPrincipal = 0;
  for (let k = 0; k < n; k++) {
    const value = k === n - 1 ? agreed - base * (n - 1) : base;
    cumValue += value;
    const p = Math.floor((cumValue * principal) / agreed) - cumPrincipal;
    cumPrincipal += p;
    out.push({
      number: k + 1,
      dueDate: renegDueDate(input.firstDueDate, input.method, k),
      principalCents: p,
      interestCents: value - p,
      originalCents: value,
      type: 'PARCELA_FIXA',
      isProjection: false,
      status: 'PENDENTE',
    });
  }
  const newLoan: EngineLoan = {
    type: 'FIXED_INSTALLMENT',
    method: input.method,
    principalCents: principal,
    saldoDevedorCents: principal,
    ratePercent: 0,
    multaDiaPercent: fine,
    releaseDate: input.asOf,
    status: 'ATIVO',
    // o acordo é fechado: sem amortização (o principal está diluído nas parcelas) e sem atraso longo
    allowAmortization: false,
    allowLateFee: !!input.allowLateFee && fine > 0,
    longLateMode: 'OFF',
  };
  return {
    debtCents: debt,
    saldoDevedorCents: saldo,
    agreedCents: agreed,
    principalCents: principal,
    revenueCents: agreed - principal,
    writeOffCents: saldo - principal,
    discountCents: Math.max(0, debt - agreed),
    recoveryPercent: debt > 0 ? Math.round((agreed / debt) * 10000) / 100 : 100,
    loan: newLoan,
    installments: out,
    dueDate: out[out.length - 1].dueDate,
  };
}
