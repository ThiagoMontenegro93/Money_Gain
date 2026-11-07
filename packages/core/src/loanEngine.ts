/**
 * LendControl Pro V6.5 - Motor de Empréstimos
 *
 * Funções puras: recebem o estado atual (empréstimo + parcelas) e devolvem um
 * "plano" de mudanças. O backend aplica o plano dentro de uma transação.
 *
 * Regras principais (especificação seção 1):
 *  - INTEREST_ONLY (projeção automática): parcela 1 = principal + juros
 *    (QUITACAO_PREVISTA) + 3 parcelas de projeção só de juros. Pagar só juros
 *    mantém o principal e cria nova projeção no final (sempre 3 à frente).
 *    Pagar a quitação cancela todas as projeções futuras e quita o empréstimo.
 *  - FIXED_INSTALLMENT: Tabela Price com N parcelas fixas.
 *  - Multa diária: ValorAtual = Parcela * (1 + %multa_dia * dias_atraso).
 */
import { addDays, addMonthsAnchored, diffDays, ISODate, isoToBR } from './dates';
import { Cents, pct, roundCents } from './money';

export type LoanMethod = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type LoanType = 'INTEREST_ONLY' | 'FIXED_INSTALLMENT';
export type LoanStatus = 'ATIVO' | 'QUITADO' | 'PERDA' | 'CANCELADO';
export type InstallmentType = 'QUITACAO_PREVISTA' | 'PROJECAO_JUROS' | 'PARCELA_FIXA';
export type InstallmentStatus = 'PENDENTE' | 'PAGA' | 'CANCELADA';
export type PaymentType = 'JUROS' | 'QUITACAO' | 'AMORTIZACAO' | 'PARCELA';
export type InstallmentDisplayStatus = 'PAGA' | 'CANCELADA' | 'ATRASADA' | 'PENDENTE' | 'PROJECAO';

/** Quantidade de parcelas de projeção mantidas à frente da parcela atual. */
export const PROJECTION_WINDOW = 3;

export const METHOD_LABEL: Record<LoanMethod, string> = {
  DAILY: 'Diário',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
};

export interface EngineLoan {
  type: LoanType;
  method: LoanMethod;
  principalCents: Cents;
  saldoDevedorCents: Cents;
  /** Taxa % por período do método (ex.: 10 = 10% ao mês no método MONTHLY). */
  ratePercent: number;
  /** Multa % ao dia sobre o valor da parcela vencida. */
  multaDiaPercent: number;
  releaseDate: ISODate;
  status: LoanStatus;
}

export interface EngineInstallment {
  number: number;
  dueDate: ISODate;
  principalCents: Cents;
  interestCents: Cents;
  /** principal + juros (valor original da parcela, sem multa). */
  originalCents: Cents;
  type: InstallmentType;
  isProjection: boolean;
  status: InstallmentStatus;
  paidCents?: Cents | null;
  paidAt?: ISODate | null;
  paidKind?: PaymentType | null;
}

export class LoanEngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LoanEngineError';
  }
}

export function dueDateFor(release: ISODate, method: LoanMethod, n: number): ISODate {
  switch (method) {
    case 'DAILY':
      return addDays(release, n);
    case 'WEEKLY':
      return addDays(release, 7 * n);
    case 'BIWEEKLY':
      return addDays(release, 14 * n);
    case 'MONTHLY':
      return addMonthsAnchored(release, n);
  }
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export interface CreateLoanInput {
  type: LoanType;
  method: LoanMethod;
  principalCents: Cents;
  ratePercent: number;
  multaDiaPercent: number;
  releaseDate: ISODate;
  /** Obrigatório para FIXED_INSTALLMENT. */
  installmentsCount?: number;
}

export interface CreatedLoan {
  loan: EngineLoan;
  installments: EngineInstallment[];
  /** Vencimento final previsto (quitação prevista ou última parcela fixa). */
  dueDate: ISODate;
}

function validateCreate(input: CreateLoanInput) {
  if (!Number.isInteger(input.principalCents) || input.principalCents <= 0)
    throw new LoanEngineError('INVALID_PRINCIPAL', 'Valor principal deve ser maior que zero');
  if (!(input.ratePercent >= 0) || input.ratePercent > 1000)
    throw new LoanEngineError('INVALID_RATE', 'Taxa deve estar entre 0% e 1000%');
  if (!(input.multaDiaPercent >= 0) || input.multaDiaPercent > 100)
    throw new LoanEngineError('INVALID_FINE', 'Multa diária deve estar entre 0% e 100%');
  if (input.type === 'FIXED_INSTALLMENT') {
    const n = input.installmentsCount ?? 0;
    if (!Number.isInteger(n) || n < 1 || n > 360)
      throw new LoanEngineError('INVALID_COUNT', 'Número de parcelas deve estar entre 1 e 360');
  }
}

/** createLoanWithProjection: cria 1 quitação prevista + 3 projeções de juros (ou tabela Price). */
export function createLoanWithProjection(input: CreateLoanInput): CreatedLoan {
  validateCreate(input);
  const loan: EngineLoan = {
    type: input.type,
    method: input.method,
    principalCents: input.principalCents,
    saldoDevedorCents: input.principalCents,
    ratePercent: input.ratePercent,
    multaDiaPercent: input.multaDiaPercent,
    releaseDate: input.releaseDate,
    status: 'ATIVO',
  };

  if (input.type === 'INTEREST_ONLY') {
    const interest = pct(input.principalCents, input.ratePercent);
    const installments: EngineInstallment[] = [];
    for (let n = 1; n <= 1 + PROJECTION_WINDOW; n++) {
      const isFirst = n === 1;
      installments.push({
        number: n,
        dueDate: dueDateFor(input.releaseDate, input.method, n),
        principalCents: isFirst ? input.principalCents : 0,
        interestCents: interest,
        originalCents: (isFirst ? input.principalCents : 0) + interest,
        type: isFirst ? 'QUITACAO_PREVISTA' : 'PROJECAO_JUROS',
        isProjection: !isFirst,
        status: 'PENDENTE',
      });
    }
    return { loan, installments, dueDate: installments[0].dueDate };
  }

  const installments = priceSchedule(
    input.principalCents,
    input.ratePercent,
    input.installmentsCount!,
  ).map((p, idx) => ({
    number: idx + 1,
    dueDate: dueDateFor(input.releaseDate, input.method, idx + 1),
    principalCents: p.principal,
    interestCents: p.interest,
    originalCents: p.principal + p.interest,
    type: 'PARCELA_FIXA' as const,
    isProjection: false,
    status: 'PENDENTE' as const,
  }));
  return { loan, installments, dueDate: installments[installments.length - 1].dueDate };
}

/** Tabela Price: PMT = P * i / (1 - (1+i)^-n), última parcela ajusta o arredondamento. */
export function priceSchedule(principal: Cents, ratePercent: number, n: number) {
  const i = ratePercent / 100;
  const pmt = i === 0 ? roundCents(principal / n) : roundCents((principal * i) / (1 - Math.pow(1 + i, -n)));
  const rows: { principal: Cents; interest: Cents }[] = [];
  let saldo = principal;
  for (let k = 1; k <= n; k++) {
    const interest = roundCents(saldo * i);
    const amort = k === n ? saldo : Math.min(saldo, pmt - interest);
    rows.push({ principal: amort, interest });
    saldo -= amort;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Multa / visão das parcelas
// ---------------------------------------------------------------------------

export function daysLate(dueDate: ISODate, asOf: ISODate): number {
  return Math.max(0, diffDays(asOf, dueDate));
}

/** ValorAtual = valor * (1 + %multa_dia * dias_atraso). */
export function applyLateFee(valueCents: Cents, multaDiaPercent: number, dias: number): Cents {
  if (dias <= 0) return valueCents;
  return roundCents(valueCents * (1 + (multaDiaPercent / 100) * dias));
}

export interface InstallmentView extends EngineInstallment {
  diasAtraso: number;
  /** Valor atualizado da parcela inteira (com multa). */
  updatedCents: Cents;
  /** Valor atualizado apenas dos juros (para pagamento "só juros"). */
  interestUpdatedCents: Cents;
  displayStatus: InstallmentDisplayStatus;
}

export function viewInstallment(inst: EngineInstallment, loan: EngineLoan, asOf: ISODate): InstallmentView {
  const open = inst.status === 'PENDENTE';
  const dias = open ? daysLate(inst.dueDate, asOf) : 0;
  let displayStatus: InstallmentDisplayStatus;
  if (inst.status === 'PAGA') displayStatus = 'PAGA';
  else if (inst.status === 'CANCELADA') displayStatus = 'CANCELADA';
  else if (dias > 0) displayStatus = 'ATRASADA';
  else if (inst.isProjection) displayStatus = 'PROJECAO';
  else displayStatus = 'PENDENTE';
  return {
    ...inst,
    diasAtraso: dias,
    updatedCents: open ? applyLateFee(inst.originalCents, loan.multaDiaPercent, dias) : inst.originalCents,
    interestUpdatedCents: open ? applyLateFee(inst.interestCents, loan.multaDiaPercent, dias) : inst.interestCents,
    displayStatus,
  };
}

function sortByNumber(list: EngineInstallment[]) {
  return [...list].sort((a, b) => a.number - b.number);
}

export function openInstallments(list: EngineInstallment[]) {
  return sortByNumber(list).filter((i) => i.status === 'PENDENTE');
}

// ---------------------------------------------------------------------------
// Cotação (quanto pagar hoje)
// ---------------------------------------------------------------------------

export interface PayoffQuote {
  amountCents: Cents;
  principalCents: Cents;
  interestCents: Cents;
  fineCents: Cents;
  /** Parcelas que ficam PAGAS na quitação. */
  coveredNumbers: number[];
  /** Parcelas canceladas (projeções removidas). */
  cancelledNumbers: number[];
}

export interface LoanQuote {
  asOf: ISODate;
  next: InstallmentView | null;
  /** Valor para pagar só os juros da próxima parcela (INTEREST_ONLY). */
  interestOnlyCents: Cents | null;
  /** Valor da próxima parcela fixa (FIXED_INSTALLMENT). */
  installmentCents: Cents | null;
  payoff: PayoffQuote | null;
  /** Data da próxima projeção criada se o cliente pagar só juros. */
  nextProjectionDate: ISODate | null;
  overdueCount: number;
}

/** Simular Quitação: quanto pagaria se quitasse em `asOf`. */
export function simulatePayoff(loan: EngineLoan, installments: EngineInstallment[], asOf: ISODate): PayoffQuote | null {
  if (loan.status !== 'ATIVO' && loan.status !== 'PERDA') return null;
  const open = openInstallments(installments);
  if (open.length === 0) return null;
  const views = open.map((i) => viewInstallment(i, loan, asOf));
  const overdue = views.filter((v) => v.diasAtraso > 0);
  const covered = overdue.length > 0 ? overdue : [views[0]];
  const principalInCovered = covered.reduce((s, v) => s + v.principalCents, 0);
  // Parcelas vencidas entram com multa; se nada venceu, cobra os juros do período corrente.
  const coveredValue =
    overdue.length > 0 ? covered.reduce((s, v) => s + v.updatedCents, 0) : views[0].originalCents;
  const amount = coveredValue + (loan.saldoDevedorCents - principalInCovered);
  const interest = covered.reduce((s, v) => s + v.interestCents, 0);
  const coveredNumbers = covered.map((v) => v.number);
  return {
    amountCents: amount,
    principalCents: loan.saldoDevedorCents,
    interestCents: interest,
    fineCents: amount - loan.saldoDevedorCents - interest,
    coveredNumbers,
    cancelledNumbers: views.filter((v) => !coveredNumbers.includes(v.number)).map((v) => v.number),
  };
}

export function quoteLoan(loan: EngineLoan, installments: EngineInstallment[], asOf: ISODate): LoanQuote {
  const open = openInstallments(installments);
  const next = open.length ? viewInstallment(open[0], loan, asOf) : null;
  const maxNumber = installments.reduce((m, i) => Math.max(m, i.number), 0);
  const active = loan.status === 'ATIVO' || loan.status === 'PERDA';
  return {
    asOf,
    next,
    interestOnlyCents: active && next && loan.type === 'INTEREST_ONLY' ? next.interestUpdatedCents : null,
    installmentCents: active && next && loan.type === 'FIXED_INSTALLMENT' ? next.updatedCents : null,
    payoff: simulatePayoff(loan, installments, asOf),
    nextProjectionDate:
      active && loan.type === 'INTEREST_ONLY' ? dueDateFor(loan.releaseDate, loan.method, maxNumber + 1) : null,
    overdueCount: open.filter((i) => daysLate(i.dueDate, asOf) > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Aplicação de pagamentos (executada somente após APROVAÇÃO)
// ---------------------------------------------------------------------------

export interface PaymentInput {
  type: PaymentType;
  amountCents: Cents;
  /** Data em que o cliente pagou (base do cálculo de multa). */
  asOf: ISODate;
  /** Parcela informada pelo operador (opcional; validada contra a próxima em aberto). */
  installmentNumber?: number;
}

export interface PaymentAllocation {
  principalCents: Cents;
  interestCents: Cents;
  fineCents: Cents;
  /** Valor pago acima do devido (tratado como receita de juros). */
  extraCents: Cents;
}

export interface EnginePlan {
  updates: { number: number; changes: Partial<EngineInstallment> }[];
  creates: EngineInstallment[];
  loanChanges: Partial<EngineLoan> & { quitadoEm?: ISODate };
  allocation: PaymentAllocation;
  /** Parcela à qual o pagamento foi vinculado. */
  installmentNumber: number | null;
  cancelledCount: number;
  message: string;
}

function assertActive(loan: EngineLoan) {
  if (loan.status !== 'ATIVO' && loan.status !== 'PERDA')
    throw new LoanEngineError('LOAN_NOT_ACTIVE', `Empréstimo não está ativo (status ${loan.status})`);
}

function firstOpenOrThrow(installments: EngineInstallment[], requested?: number) {
  const open = openInstallments(installments);
  if (!open.length) throw new LoanEngineError('NO_OPEN_INSTALLMENT', 'Não há parcelas em aberto');
  if (requested !== undefined && requested !== open[0].number)
    throw new LoanEngineError(
      'OUT_OF_ORDER',
      `Pague primeiro a parcela ${open[0].number} (vencimento ${isoToBR(open[0].dueDate)})`,
    );
  return { open, target: open[0] };
}

function assertAmount(amount: Cents, due: Cents, label: string) {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new LoanEngineError('INVALID_AMOUNT', 'Valor do pagamento deve ser maior que zero');
  if (amount < due)
    throw new LoanEngineError(
      'INSUFFICIENT_AMOUNT',
      `Valor insuficiente para ${label}: devido ${(due / 100).toFixed(2)}, informado ${(amount / 100).toFixed(2)}`,
    );
}

/** Garante a janela de projeção: 1 parcela atual + PROJECTION_WINDOW futuras em aberto. */
function topUpProjections(loan: EngineLoan, all: EngineInstallment[], openAfter: number, saldo: Cents) {
  const creates: EngineInstallment[] = [];
  let maxNumber = all.reduce((m, i) => Math.max(m, i.number), 0);
  const interest = pct(saldo, loan.ratePercent);
  let open = openAfter;
  while (open < 1 + PROJECTION_WINDOW) {
    maxNumber++;
    creates.push({
      number: maxNumber,
      dueDate: dueDateFor(loan.releaseDate, loan.method, maxNumber),
      principalCents: 0,
      interestCents: interest,
      originalCents: interest,
      type: 'PROJECAO_JUROS',
      isProjection: true,
      status: 'PENDENTE',
    });
    open++;
  }
  return creates;
}

/** onPayInterest: paga só juros, mantém principal, cria nova projeção (sempre 3 à frente). */
export function onPayInterest(loan: EngineLoan, installments: EngineInstallment[], p: PaymentInput): EnginePlan {
  assertActive(loan);
  if (loan.type !== 'INTEREST_ONLY')
    throw new LoanEngineError('WRONG_TYPE', 'Pagamento só de juros vale apenas para empréstimos de juros (projeção)');
  const { open, target } = firstOpenOrThrow(installments, p.installmentNumber);
  const view = viewInstallment(target, loan, p.asOf);
  assertAmount(p.amountCents, view.interestUpdatedCents, 'pagar os juros');

  const updates: EnginePlan['updates'] = [
    {
      number: target.number,
      changes: { status: 'PAGA', paidCents: p.amountCents, paidAt: p.asOf, paidKind: 'JUROS' },
    },
  ];
  // O principal "migra" para a próxima parcela, que passa a ser a quitação prevista.
  const next = open[1];
  if (next && target.type === 'QUITACAO_PREVISTA') {
    updates.push({
      number: next.number,
      changes: {
        type: 'QUITACAO_PREVISTA',
        isProjection: false,
        principalCents: loan.saldoDevedorCents,
        originalCents: loan.saldoDevedorCents + next.interestCents,
      },
    });
  }
  const creates = topUpProjections(loan, installments, open.length - 1, loan.saldoDevedorCents);
  if (!next && creates.length) {
    // Caso extremo: não havia projeções; a primeira criada vira a quitação prevista.
    creates[0].type = 'QUITACAO_PREVISTA';
    creates[0].isProjection = false;
    creates[0].principalCents = loan.saldoDevedorCents;
    creates[0].originalCents = loan.saldoDevedorCents + creates[0].interestCents;
  }
  return {
    updates,
    creates,
    loanChanges: {},
    allocation: {
      principalCents: 0,
      interestCents: target.interestCents,
      fineCents: view.interestUpdatedCents - target.interestCents,
      extraCents: p.amountCents - view.interestUpdatedCents,
    },
    installmentNumber: target.number,
    cancelledCount: 0,
    message:
      `Juros da parcela ${target.number} pagos. Principal mantido. ` +
      (creates.length ? `Nova projeção criada: ${isoToBR(creates[creates.length - 1].dueDate)}` : ''),
  };
}

/** onPayQuitacao: quita o empréstimo, remove todas as projeções futuras. */
export function onPayQuitacao(loan: EngineLoan, installments: EngineInstallment[], p: PaymentInput): EnginePlan {
  assertActive(loan);
  const quote = simulatePayoff(loan, installments, p.asOf);
  if (!quote) throw new LoanEngineError('NO_OPEN_INSTALLMENT', 'Não há parcelas em aberto');
  if (p.installmentNumber !== undefined && !quote.coveredNumbers.includes(p.installmentNumber)) {
    // Permite informar qualquer parcela em aberto: a quitação sempre cobre as vencidas + a atual.
    const exists = openInstallments(installments).some((i) => i.number === p.installmentNumber);
    if (!exists) throw new LoanEngineError('INVALID_INSTALLMENT', `Parcela ${p.installmentNumber} não está em aberto`);
  }
  assertAmount(p.amountCents, quote.amountCents, 'quitar');
  const updates: EnginePlan['updates'] = [];
  const views = openInstallments(installments).map((i) => viewInstallment(i, loan, p.asOf));
  const lastCovered = quote.coveredNumbers[quote.coveredNumbers.length - 1];
  const othersPaid = views
    .filter((o) => quote.coveredNumbers.includes(o.number) && o.number !== lastCovered)
    .reduce((s, o) => s + o.updatedCents, 0);
  for (const v of views) {
    if (quote.coveredNumbers.includes(v.number)) {
      updates.push({
        number: v.number,
        changes: {
          status: 'PAGA',
          paidAt: p.asOf,
          paidKind: 'QUITACAO',
          // A última parcela coberta recebe o principal remanescente e o excedente.
          paidCents: v.number === lastCovered ? p.amountCents - othersPaid : v.updatedCents,
        },
      });
    } else {
      updates.push({ number: v.number, changes: { status: 'CANCELADA' } });
    }
  }
  const cancelled = quote.cancelledNumbers.length;
  return {
    updates,
    creates: [],
    loanChanges: { saldoDevedorCents: 0, status: 'QUITADO', quitadoEm: p.asOf },
    allocation: {
      principalCents: quote.principalCents,
      interestCents: quote.interestCents,
      fineCents: quote.fineCents,
      extraCents: p.amountCents - quote.amountCents,
    },
    installmentNumber: lastCovered,
    cancelledCount: cancelled,
    message: `Quitado em ${isoToBR(p.asOf)} - ${cancelled} parcela${cancelled === 1 ? '' : 's'} de projeção removida${cancelled === 1 ? '' : 's'}`,
  };
}

/** Pagamento de parcela fixa (Tabela Price). */
export function onPayFixedInstallment(loan: EngineLoan, installments: EngineInstallment[], p: PaymentInput): EnginePlan {
  assertActive(loan);
  if (loan.type !== 'FIXED_INSTALLMENT')
    throw new LoanEngineError('WRONG_TYPE', 'Pagamento de parcela vale apenas para empréstimos de parcela fixa');
  const { open, target } = firstOpenOrThrow(installments, p.installmentNumber);
  const view = viewInstallment(target, loan, p.asOf);
  assertAmount(p.amountCents, view.updatedCents, 'pagar a parcela');
  const saldo = loan.saldoDevedorCents - target.principalCents;
  const finished = open.length === 1;
  return {
    updates: [{ number: target.number, changes: { status: 'PAGA', paidCents: p.amountCents, paidAt: p.asOf, paidKind: 'PARCELA' } }],
    creates: [],
    loanChanges: finished
      ? { saldoDevedorCents: 0, status: 'QUITADO', quitadoEm: p.asOf }
      : { saldoDevedorCents: saldo },
    allocation: {
      principalCents: target.principalCents,
      interestCents: target.interestCents,
      fineCents: view.updatedCents - target.originalCents,
      extraCents: p.amountCents - view.updatedCents,
    },
    installmentNumber: target.number,
    cancelledCount: 0,
    message: finished
      ? `Última parcela paga. Empréstimo quitado em ${isoToBR(p.asOf)}`
      : `Parcela ${target.number} paga. Saldo devedor: ${(saldo / 100).toFixed(2)}`,
  };
}

/** Amortização parcial do principal: recalcula juros das parcelas em aberto. */
export function onAmortize(loan: EngineLoan, installments: EngineInstallment[], p: PaymentInput): EnginePlan {
  assertActive(loan);
  const open = openInstallments(installments);
  if (!open.length) throw new LoanEngineError('NO_OPEN_INSTALLMENT', 'Não há parcelas em aberto');
  if (open.some((i) => daysLate(i.dueDate, p.asOf) > 0))
    throw new LoanEngineError('HAS_OVERDUE', 'Regularize as parcelas em atraso antes de amortizar');
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0)
    throw new LoanEngineError('INVALID_AMOUNT', 'Valor da amortização deve ser maior que zero');
  if (p.amountCents >= loan.saldoDevedorCents)
    throw new LoanEngineError('USE_PAYOFF', 'Valor cobre todo o saldo: use QUITAÇÃO');
  const saldo = loan.saldoDevedorCents - p.amountCents;
  const updates: EnginePlan['updates'] = [];
  if (loan.type === 'INTEREST_ONLY') {
    const interest = pct(saldo, loan.ratePercent);
    open.forEach((i, idx) => {
      const principal = idx === 0 ? saldo : 0;
      updates.push({ number: i.number, changes: { interestCents: interest, principalCents: principal, originalCents: principal + interest } });
    });
  } else {
    priceSchedule(saldo, loan.ratePercent, open.length).forEach((row, idx) => {
      updates.push({
        number: open[idx].number,
        changes: { principalCents: row.principal, interestCents: row.interest, originalCents: row.principal + row.interest },
      });
    });
  }
  return {
    updates,
    creates: [],
    loanChanges: { saldoDevedorCents: saldo },
    allocation: { principalCents: p.amountCents, interestCents: 0, fineCents: 0, extraCents: 0 },
    installmentNumber: null,
    cancelledCount: 0,
    message: `Amortização de ${(p.amountCents / 100).toFixed(2)} aplicada. Novo saldo: ${(saldo / 100).toFixed(2)}`,
  };
}

export function planPayment(loan: EngineLoan, installments: EngineInstallment[], p: PaymentInput): EnginePlan {
  switch (p.type) {
    case 'JUROS':
      return onPayInterest(loan, installments, p);
    case 'QUITACAO':
      return onPayQuitacao(loan, installments, p);
    case 'PARCELA':
      return onPayFixedInstallment(loan, installments, p);
    case 'AMORTIZACAO':
      return onAmortize(loan, installments, p);
  }
}

/** Valor esperado para um tipo de pagamento na data informada (usado na tela de lançamento). */
export function expectedAmount(loan: EngineLoan, installments: EngineInstallment[], type: PaymentType, asOf: ISODate): Cents | null {
  const q = quoteLoan(loan, installments, asOf);
  if (type === 'JUROS') return q.interestOnlyCents;
  if (type === 'PARCELA') return q.installmentCents;
  if (type === 'QUITACAO') return q.payoff?.amountCents ?? null;
  return null;
}

/** Aplica um plano a uma lista em memória (útil para testes, offline e simulações). */
export function applyPlan(loan: EngineLoan, installments: EngineInstallment[], plan: EnginePlan) {
  const { quitadoEm: _q, ...loanChanges } = plan.loanChanges;
  const nextLoan: EngineLoan = { ...loan, ...loanChanges };
  const nextInst = installments.map((i) => {
    const u = plan.updates.find((x) => x.number === i.number);
    return u ? { ...i, ...u.changes } : i;
  });
  return { loan: nextLoan, installments: sortByNumber([...nextInst, ...plan.creates]) };
}
