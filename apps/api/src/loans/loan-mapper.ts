import {
  daysLate,
  EngineInstallment,
  EngineLoan,
  ISODate,
  openInstallments,
  quoteLoan,
  simulatePayoff,
  diffDays,
  viewInstallment,
} from '@lendcontrol/core';
import { Installment, Loan, Payment, User } from '@prisma/client';
import { c, cn, iso, num, ref } from '../common/util';

export function toEngineLoan(l: Loan): EngineLoan {
  return {
    type: l.type,
    method: l.method,
    principalCents: c(l.principal),
    saldoDevedorCents: c(l.saldoDevedor),
    ratePercent: num(l.interestRate),
    multaDiaPercent: num(l.multaDiaPercent),
    releaseDate: iso(l.releaseDate)!,
    status: l.status,
    allowAmortization: l.allowAmortization,
    allowLateFee: l.allowLateFee,
  };
}

export function toEngineInstallment(i: Installment): EngineInstallment {
  return {
    number: i.number,
    dueDate: iso(i.dueDate)!,
    principalCents: c(i.principalValue),
    interestCents: c(i.interestValue),
    originalCents: c(i.originalValue),
    type: i.type,
    isProjection: i.isProjection,
    status: i.status,
    paidCents: cn(i.paidValue),
    paidAt: iso(i.paidAt),
    paidKind: i.paidKind,
  };
}

type LoanWith = Loan & {
  installments: Installment[];
  client: { id: string; fullName: string };
  lender: User | { id: string; name: string };
  funder: User | { id: string; name: string };
};

export function loanSummary(l: LoanWith, asOf: ISODate) {
  const eLoan = toEngineLoan(l);
  const eInst = l.installments.map(toEngineInstallment);
  const open = openInstallments(eInst);
  const next = open[0] ? viewInstallment(open[0], eLoan, asOf) : null;
  const paid = eInst.filter((i) => i.status === 'PAGA' && i.paidAt).map((i) => i.paidAt!) as string[];
  const lastPaid = paid.sort().at(-1) ?? null;
  const active = l.status === 'ATIVO' || l.status === 'PERDA';
  const overdueCount = open.filter((i) => daysLate(i.dueDate, asOf) > 0).length;
  return {
    id: l.id,
    code: l.code,
    clientId: l.clientId,
    clientName: l.client.fullName,
    lender: ref(l.lender),
    funder: ref(l.funder),
    type: l.type,
    method: l.method,
    principalCents: c(l.principal),
    ratePercent: num(l.interestRate),
    multaDiaPercent: num(l.multaDiaPercent),
    allowAmortization: l.allowAmortization,
    allowLateFee: l.allowLateFee,
    installmentsCount: l.installmentsCount,
    releaseDate: iso(l.releaseDate)!,
    dueDate: iso(l.dueDate)!,
    status: l.status,
    saldoDevedorCents: c(l.saldoDevedor),
    /** Dívida atualizada para quitar hoje (saldo + juros do período + multas). */
    payoffCents: active ? (simulatePayoff(eLoan, eInst, asOf)?.amountCents ?? 0) : 0,
    nextDueDate: next?.dueDate ?? null,
    nextValueCents: next ? next.updatedCents : null,
    overdueCount,
    diasSemPagar: active && overdueCount > 0 ? Math.max(0, diffDays(asOf, lastPaid ?? iso(l.releaseDate)!)) : 0,
    quitadoEm: iso(l.quitadoEm),
    riskAcknowledged: l.riskAcknowledged,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
  };
}

export function loanViews(l: Loan & { installments: Installment[] }, asOf: ISODate) {
  const eLoan = toEngineLoan(l);
  const sorted = [...l.installments].sort((a, b) => a.number - b.number);
  const eInst = sorted.map(toEngineInstallment);
  return {
    installments: sorted.map((i, idx) => ({ id: i.id, ...viewInstallment(eInst[idx], eLoan, asOf) })),
    quote: quoteLoan(eLoan, eInst, asOf),
  };
}

type PaymentWith = Payment & {
  loan: Loan & { client: { id: string; fullName: string } };
  installment: Installment | null;
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
};

export function paymentDTO(p: PaymentWith) {
  return {
    id: p.id,
    loanId: p.loanId,
    loanCode: p.loan.code,
    clientId: p.loan.client.id,
    clientName: p.loan.client.fullName,
    type: p.type,
    status: p.status,
    valueCents: c(p.value),
    expectedValueCents: cn(p.expectedValue),
    paidAt: iso(p.paidAt)!,
    installmentNumber: p.installment?.number ?? null,
    comprovanteFileId: p.comprovanteFileId,
    notes: p.notes,
    createdBy: ref(p.createdBy)!,
    approvedBy: ref(p.approvedBy),
    approvedAt: p.approvedAt?.toISOString() ?? null,
    rejectionReason: p.rejectionReason,
    resultMessage: p.resultMessage,
    allocation:
      p.status === 'APROVADO'
        ? {
            principalCents: c(p.principalPart),
            interestCents: c(p.interestPart),
            fineCents: c(p.finePart),
            extraCents: c(p.extraPart),
            commissionCents: c(p.commissionPart),
          }
        : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export const paymentInclude = {
  loan: { include: { client: { select: { id: true, fullName: true } } } },
  installment: true,
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

export const loanInclude = {
  installments: true,
  client: { select: { id: true, fullName: true } },
  lender: { select: { id: true, name: true } },
  funder: { select: { id: true, name: true } },
} as const;
