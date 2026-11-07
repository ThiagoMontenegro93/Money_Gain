import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  createLoanWithProjection,
  CreateLoanInput,
  evaluateCreditLock,
  isValidISODate,
  quoteLoan,
  viewInstallment,
} from '@lendcontrol/core';
import { LoanStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { d, dt, num, today, ZodPipe } from '../common/util';
import { ClientsService } from '../clients/clients.service';
import { ScoreService } from '../clients/score.service';
import { loanInclude, loanSummary, loanViews, paymentDTO, paymentInclude, toEngineInstallment, toEngineLoan } from './loan-mapper';

const isoDate = z.string().refine(isValidISODate, 'Data inválida (YYYY-MM-DD)');
const loanBase = z.object({
  type: z.enum(['INTEREST_ONLY', 'FIXED_INSTALLMENT']),
  method: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  principalCents: z.number().int().positive().max(1_000_000_000),
  ratePercent: z.number().min(0).max(1000),
  multaDiaPercent: z.number().min(0).max(100),
  releaseDate: isoDate,
  installmentsCount: z.number().int().min(1).max(360).optional(),
});
const createSchema = loanBase.extend({
  clientId: z.string(),
  lenderUserId: z.string().optional(),
  riskAcknowledged: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private clients: ClientsService,
    private score: ScoreService,
    private audit: AuditService,
  ) {}

  scope(u: AuthUser): Prisma.LoanWhereInput {
    return isAdmin(u) ? {} : { lenderUserId: u.id };
  }

  preview(b: z.infer<typeof loanBase>) {
    const created = createLoanWithProjection(b as CreateLoanInput);
    return {
      dueDate: created.dueDate,
      installments: created.installments.map((i) => viewInstallment(i, created.loan, b.releaseDate)),
      totalInterestCents: created.installments.reduce((s, i) => s + i.interestCents, 0),
    };
  }

  async creditCheck(u: AuthUser, clientId: string) {
    await this.clients.assertAccess(u, clientId);
    const r = await this.score.recompute(clientId);
    const cl = await this.prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    const lock = evaluateCreditLock({
      score: cl.score,
      classificacao: cl.classificacao,
      isBlocked: cl.isBlocked,
      pontualidade: cl.pontualidade === null ? null : num(cl.pontualidade),
      diasSemPagar: r.diasSemPagar,
      openDebtCents: r.openDebtCents,
    });
    if (lock.level === 'BLOCKED' && !cl.isBlocked && cl.unblockedAt)
      return { level: 'WARNING' as const, title: '⚠️ Cliente PERDA desbloqueado pelo Super Admin', message: 'Empreste com cautela: cliente com histórico de perda.' };
    if (cl.status === 'RASCUNHO')
      return { level: 'BLOCKED' as const, title: 'Ficha incompleta', message: 'Complete a ficha do cliente (Salvar Cliente Completo) antes de emprestar.' };
    return lock;
  }

  async create(u: AuthUser, b: z.infer<typeof createSchema>) {
    const lock = await this.creditCheck(u, b.clientId);
    if (lock.level === 'BLOCKED') throw new BadRequestException({ message: `${lock.title}. ${lock.message}`, code: 'CREDIT_BLOCKED' });
    if (lock.level === 'WARNING' && !b.riskAcknowledged)
      throw new BadRequestException({ message: `${lock.title}. ${lock.message}`, code: 'RISK_NOT_ACKNOWLEDGED' });

    const lenderId = b.lenderUserId && isAdmin(u) ? b.lenderUserId : u.id;
    if (b.lenderUserId && !isAdmin(u) && b.lenderUserId !== u.id) throw new ForbiddenException('Operador só empresta pela própria carteira');
    const lender = await this.prisma.user.findUnique({ where: { id: lenderId } });
    if (!lender || !lender.isActive) throw new NotFoundException('Funcionário não encontrado');
    const owner = await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
    const funderId = lender.role === 'OPERATOR' ? (owner?.id ?? lender.id) : lender.id;

    const created = createLoanWithProjection(b as CreateLoanInput);
    const loan = await this.prisma.$transaction(async (tx) => {
      if (lender.role === 'OPERATOR') {
        // Trava de saldo atômica: só debita se houver capital disponível
        const upd = await tx.user.updateMany({
          where: { id: lenderId, capitalDisponivel: { gte: d(b.principalCents) } },
          data: { capitalDisponivel: { decrement: d(b.principalCents) }, capitalEmprestado: { increment: d(b.principalCents) } },
        });
        if (upd.count === 0)
          throw new BadRequestException({ message: `Capital disponível insuficiente na carteira de ${lender.name}`, code: 'INSUFFICIENT_CAPITAL' });
      } else {
        await tx.user.update({ where: { id: lenderId }, data: { capitalEmprestado: { increment: d(b.principalCents) } } });
      }
      const l = await tx.loan.create({
        data: {
          clientId: b.clientId,
          funderUserId: funderId,
          lenderUserId: lenderId,
          principal: d(b.principalCents),
          interestRate: b.ratePercent,
          multaDiaPercent: b.multaDiaPercent,
          method: b.method,
          type: b.type,
          installmentsCount: b.type === 'FIXED_INSTALLMENT' ? b.installmentsCount : null,
          releaseDate: dt(b.releaseDate),
          dueDate: dt(created.dueDate),
          saldoDevedor: d(b.principalCents),
          riskAcknowledged: !!b.riskAcknowledged,
          notes: b.notes,
          createdById: u.id,
          installments: {
            create: created.installments.map((i) => ({
              number: i.number,
              dueDate: dt(i.dueDate),
              principalValue: d(i.principalCents),
              interestValue: d(i.interestCents),
              originalValue: d(i.originalCents),
              updatedValue: d(i.originalCents),
              multaDiaPercent: b.multaDiaPercent,
              type: i.type,
              isProjection: i.isProjection,
            })),
          },
        },
      });
      await tx.cashLedger.create({
        data: { userId: lenderId, type: 'SAIDA_EMPRESTIMO', amount: d(-b.principalCents), description: `Empréstimo #${l.code} liberado`, loanId: l.id },
      });
      await tx.client.updateMany({ where: { id: b.clientId, responsibleUserId: null }, data: { responsibleUserId: lenderId } });
      await this.audit.log(u.id, 'CREATE', 'Loan', l.id, { principalCents: b.principalCents, lenderId, riskAcknowledged: !!b.riskAcknowledged }, tx);
      return l;
    });
    await this.score.recompute(b.clientId);
    return this.detail(u, loan.id);
  }

  async list(u: AuthUser, q: { clientId?: string; status?: LoanStatus; lenderUserId?: string }) {
    const rows = await this.prisma.loan.findMany({
      where: {
        ...this.scope(u),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.lenderUserId ? { lenderUserId: q.lenderUserId } : {}),
      },
      include: loanInclude,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const asOf = today();
    return rows.map((l) => loanSummary(l, asOf));
  }

  async findOrThrow(u: AuthUser, id: string) {
    const loan = await this.prisma.loan.findFirst({ where: { id, ...this.scope(u) }, include: loanInclude });
    if (!loan) throw new NotFoundException('Empréstimo não encontrado');
    return loan;
  }

  async detail(u: AuthUser, id: string) {
    const loan = await this.findOrThrow(u, id);
    const asOf = today();
    const payments = await this.prisma.payment.findMany({ where: { loanId: id }, include: paymentInclude, orderBy: { createdAt: 'desc' } });
    const client = await this.clients.item(loan.clientId);
    return { ...loanSummary(loan, asOf), ...loanViews(loan, asOf), payments: payments.map(paymentDTO), client };
  }

  async quote(u: AuthUser, id: string, asOf?: string) {
    const loan = await this.findOrThrow(u, id);
    const date = asOf && isValidISODate(asOf) ? asOf : today();
    return quoteLoan(toEngineLoan(loan), loan.installments.map(toEngineInstallment), date);
  }
}

@Controller('loans')
export class LoansController {
  constructor(private loans: LoansService) {}

  @Post('preview')
  preview(@Body(new ZodPipe(loanBase)) b: z.infer<typeof loanBase>) {
    return this.loans.preview(b);
  }

  @Get('credit-check')
  creditCheck(@CurrentUser() u: AuthUser, @Query('clientId') clientId: string) {
    return this.loans.creditCheck(u, clientId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.loans.create(u, b);
  }

  @Get()
  list(
    @CurrentUser() u: AuthUser,
    @Query('clientId') clientId?: string,
    @Query('status') status?: LoanStatus,
    @Query('lenderUserId') lenderUserId?: string,
  ) {
    return this.loans.list(u, { clientId: clientId || undefined, status: status || undefined, lenderUserId: lenderUserId || undefined });
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.loans.detail(u, id);
  }

  @Get(':id/quote')
  quote(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.loans.quote(u, id, asOf);
  }
}
