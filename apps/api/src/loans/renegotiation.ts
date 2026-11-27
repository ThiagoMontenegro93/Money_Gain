/**
 * Negociação emergencial (dívida antiga vira acordo menor/parcelado) e simulação "e se?" das opções do empréstimo.
 */
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { formatBRL, isValidISODate, planRenegotiation, RenegotiationInput, simulateLoanChanges } from '@lendcontrol/core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { d, dt, today, ZodPipe } from '../common/util';
import { ScoreService } from '../clients/score.service';
import { UsersService } from '../users/users';
import { LoansService } from './loans';
import { renegDTO as toDTO, toEngineInstallment, toEngineLoan } from './loan-mapper';

const renegSchema = z.object({
  agreedCents: z.number().int().positive().max(1_000_000_000),
  installmentsCount: z.number().int().min(1).max(360),
  method: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  firstDueDate: z.string().refine(isValidISODate, 'Data inválida (YYYY-MM-DD)'),
  allowLateFee: z.boolean().optional(),
  multaDiaPercent: z.number().min(0).max(100).optional(),
  reason: z.string().trim().max(1000).optional(),
});
const confirmSchema = renegSchema.extend({ reason: z.string().trim().min(3, 'Explique o motivo do acordo').max(1000), password: z.string().min(1) });

const simulateSchema = z.object({
  ratePercent: z.number().min(0).max(1000).optional(),
  multaDiaPercent: z.number().min(0).max(100).optional(),
  allowLateFee: z.boolean().optional(),
  allowAmortization: z.boolean().optional(),
  longLateMode: z.enum(['OFF', 'PERCENT', 'FIXED']).optional(),
  longLateAfterDays: z.number().int().min(1).max(3650).optional(),
  longLatePercent: z.number().min(0).max(100).optional(),
  longLateFixedCents: z.number().int().min(0).max(100_000_000).optional(),
  asOf: z.string().refine(isValidISODate, 'Data inválida (YYYY-MM-DD)').optional(),
});

type RenegBody = z.infer<typeof renegSchema>;

@Injectable()
export class RenegotiationService {
  constructor(
    private prisma: PrismaService,
    private loans: LoansService,
    private users: UsersService,
    private audit: AuditService,
    private score: ScoreService,
  ) {}

  private async plan(u: AuthUser, id: string, b: RenegBody) {
    const loan = await this.loans.findOrThrow(u, id);
    const input: RenegotiationInput = { ...b, asOf: today() };
    return { loan, plan: planRenegotiation(toEngineLoan(loan), loan.installments.map(toEngineInstallment), input) };
  }

  /** Mostra como ficaria o acordo, sem gravar nada. */
  async preview(u: AuthUser, id: string, b: RenegBody) {
    const { plan } = await this.plan(u, id, b);
    return {
      debtCents: plan.debtCents,
      saldoDevedorCents: plan.saldoDevedorCents,
      agreedCents: plan.agreedCents,
      principalCents: plan.principalCents,
      revenueCents: plan.revenueCents,
      writeOffCents: plan.writeOffCents,
      discountCents: plan.discountCents,
      recoveryPercent: plan.recoveryPercent,
      dueDate: plan.dueDate,
      installments: plan.installments.map((i) => ({ number: i.number, dueDate: i.dueDate, valueCents: i.originalCents, principalCents: i.principalCents, interestCents: i.interestCents })),
    };
  }

  /** Fecha o acordo: encerra o empréstimo antigo como RENEGOCIADO, cria o acordo e lança o prejuízo. */
  async confirm(u: AuthUser, id: string, b: z.infer<typeof confirmSchema>) {
    await this.users.verifyPassword(u.id, b.password);
    const { loan, plan } = await this.plan(u, id, b);
    const pending = await this.prisma.payment.count({ where: { loanId: id, status: 'AGUARDANDO_APROVACAO' } });
    if (pending) throw new ConflictException({ message: 'Há um recibo aguardando aprovação neste empréstimo. Aprove ou rejeite antes de renegociar.', code: 'PENDING_PAYMENT' });
    const asOf = today();
    const newLoan = await this.prisma.$transaction(async (tx) => {
      // trava otimista: se alguém mexeu no empréstimo agora, não fecha o acordo em cima de dados velhos
      const upd = await tx.loan.updateMany({
        where: { id, version: loan.version, status: { in: ['ATIVO', 'PERDA'] } },
        data: { status: 'RENEGOCIADO', saldoDevedor: d(0), version: { increment: 1 } },
      });
      if (upd.count === 0) throw new ConflictException({ message: 'O empréstimo mudou enquanto você renegociava. Abra de novo e confira.', code: 'STALE' });
      await tx.installment.updateMany({ where: { loanId: id, status: 'PENDENTE' }, data: { status: 'CANCELADA', diasAtraso: 0 } });
      const created = await tx.loan.create({
        data: {
          clientId: loan.clientId,
          funderUserId: loan.funderUserId,
          lenderUserId: loan.lenderUserId,
          principal: d(plan.principalCents),
          interestRate: 0,
          multaDiaPercent: plan.loan.multaDiaPercent,
          allowAmortization: false,
          allowLateFee: !!plan.loan.allowLateFee,
          longLateMode: 'OFF',
          method: b.method,
          type: 'FIXED_INSTALLMENT',
          installmentsCount: b.installmentsCount,
          releaseDate: dt(asOf),
          dueDate: dt(plan.dueDate),
          saldoDevedor: d(plan.principalCents),
          isProjection: true,
          parentLoanId: loan.id,
          riskAcknowledged: true,
          notes: `Acordo da negociação emergencial do empréstimo #${loan.code}. Motivo: ${b.reason}`,
          createdById: u.id,
          installments: {
            create: plan.installments.map((i) => ({
              number: i.number,
              dueDate: dt(i.dueDate),
              principalValue: d(i.principalCents),
              interestValue: d(i.interestCents),
              originalValue: d(i.originalCents),
              updatedValue: d(i.originalCents),
              multaDiaPercent: plan.loan.multaDiaPercent,
              type: 'PARCELA_FIXA',
              isProjection: false,
            })),
          },
        },
      });
      // o capital que não volta sai do "emprestado" de quem emprestou e fica registrado como perda no caixa
      await tx.user.update({ where: { id: loan.lenderUserId }, data: { capitalEmprestado: { decrement: d(plan.writeOffCents) } } });
      if (plan.writeOffCents > 0)
        await tx.cashLedger.create({
          data: {
            userId: loan.lenderUserId,
            loanId: loan.id,
            type: 'PERDA_RENEGOCIACAO',
            amount: d(-plan.writeOffCents),
            description: `Empréstimo #${loan.code} - prejuízo na negociação emergencial (acordo #${created.code})`,
          },
        });
      const reneg = await tx.renegotiation.create({
        data: {
          oldLoanId: loan.id,
          newLoanId: created.id,
          clientId: loan.clientId,
          debtValue: d(plan.debtCents),
          saldoDevedor: d(plan.saldoDevedorCents),
          agreedValue: d(plan.agreedCents),
          installmentsCount: b.installmentsCount,
          method: b.method,
          firstDueDate: dt(b.firstDueDate),
          writeOff: d(plan.writeOffCents),
          discount: d(plan.discountCents),
          reason: b.reason,
          createdById: u.id,
        },
      });
      await this.audit.log(
        u.id,
        'RENEGOTIATE',
        'Loan',
        loan.id,
        { renegotiationId: reneg.id, newLoanId: created.id, debtCents: plan.debtCents, agreedCents: plan.agreedCents, writeOffCents: plan.writeOffCents, discountCents: plan.discountCents, installments: b.installmentsCount, reason: b.reason },
        tx,
      );
      return created;
    });
    await this.audit.notifyAdmins(
      'Negociação emergencial',
      `${u.name} fechou acordo de ${formatBRL(plan.agreedCents)} em ${b.installmentsCount}x com ${loan.client.fullName} (dívida ${formatBRL(plan.debtCents)}, prejuízo de capital ${formatBRL(plan.writeOffCents)})`,
      { loanId: newLoan.id },
    ).catch(() => undefined);
    await this.score.recompute(loan.clientId);
    return this.loans.detail(u, newLoan.id);
  }

  /** Histórico de acordos (painel e relatórios). */
  async list(u: AuthUser, clientId?: string) {
    const rows = await this.prisma.renegotiation.findMany({
      where: { ...(clientId ? { clientId } : {}), ...(isAdmin(u) ? {} : { oldLoan: { lenderUserId: u.id } }) },
      include: { oldLoan: { select: { code: true, client: { select: { fullName: true } } } }, newLoan: { select: { code: true, status: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toDTO);
  }

  /** Simula mudanças nas opções do empréstimo (taxa, multa, atraso longo) sem gravar. */
  async simulate(u: AuthUser, id: string, b: z.infer<typeof simulateSchema>) {
    const loan = await this.loans.findOrThrow(u, id);
    if (loan.status !== 'ATIVO' && loan.status !== 'PERDA') throw new BadRequestException('Empréstimo encerrado: nada para simular');
    const { asOf, ...changes } = b;
    return simulateLoanChanges(toEngineLoan(loan), loan.installments.map(toEngineInstallment), changes, asOf ?? today());
  }
}

@Controller('loans')
export class RenegotiationController {
  constructor(private s: RenegotiationService) {}

  @Get('renegotiations/list')
  list(@CurrentUser() u: AuthUser, @Query('clientId') clientId?: string) {
    return this.s.list(u, clientId || undefined);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/renegotiate/preview')
  preview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(renegSchema)) b: RenegBody) {
    return this.s.preview(u, id, b);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/renegotiate')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(confirmSchema)) b: z.infer<typeof confirmSchema>) {
    return this.s.confirm(u, id, b);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/simulate')
  simulate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(simulateSchema)) b: z.infer<typeof simulateSchema>) {
    return this.s.simulate(u, id, b);
  }
}
