import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  createLoanWithProjection,
  CreateLoanInput,
  isValidISODate,
  quoteLoan,
  viewInstallment,
} from '@lendcontrol/core';
import { LoanStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth';
import { SettingsService } from '../common/settings.service';
import { PrismaService } from '../common/prisma.service';
import { d, dt, num, today, ZodPipe } from '../common/util';
import { ClientsService, creditLockFor } from '../clients/clients.service';
import { ScoreService } from '../clients/score.service';
import { loanInclude, loanSummary, loanViews, paymentDTO, paymentInclude, toEngineInstallment, toEngineLoan } from './loan-mapper';

const isoDate = z.string().refine(isValidISODate, 'Data inválida (YYYY-MM-DD)');
const loanBase = z.object({
  type: z.enum(['INTEREST_ONLY', 'FIXED_INSTALLMENT']),
  method: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  principalCents: z.number().int().positive().max(1_000_000_000),
  ratePercent: z.number().min(0).max(1000),
  multaDiaPercent: z.number().min(0).max(100).optional(),
  releaseDate: isoDate,
  installmentsCount: z.number().int().min(1).max(360).optional(),
  allowAmortization: z.boolean().optional(),
  allowLateFee: z.boolean().optional(),
});

/** Padrão geral para novos empréstimos (Configurações > Empréstimos). */
export interface LoanDefaults {
  allowAmortization: boolean;
  allowLateFee: boolean;
  multaDiaPercent: number;
}
export const LOAN_DEFAULTS_KEY = 'loans.defaults';
export const LOAN_DEFAULTS: LoanDefaults = { allowAmortization: true, allowLateFee: true, multaDiaPercent: 1 };
const defaultsSchema = z.object({ allowAmortization: z.boolean(), allowLateFee: z.boolean(), multaDiaPercent: z.number().min(0).max(100) });
const optionsSchema = z.object({ allowAmortization: z.boolean().optional(), allowLateFee: z.boolean().optional(), multaDiaPercent: z.number().min(0).max(100).optional() });
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
    private settings: SettingsService,
  ) {}

  defaults() {
    return this.settings.get<LoanDefaults>(LOAN_DEFAULTS_KEY, LOAN_DEFAULTS);
  }

  async saveDefaults(u: AuthUser, b: LoanDefaults) {
    const saved = await this.settings.set(LOAN_DEFAULTS_KEY, b);
    await this.audit.log(u.id, 'UPDATE_LOAN_DEFAULTS', 'Setting', LOAN_DEFAULTS_KEY, { ...b });
    return saved;
  }

  /** Completa as opções não informadas com o padrão geral; sem multa, a % diária fica zerada. */
  private async withDefaults<T extends z.infer<typeof loanBase>>(b: T): Promise<T & { multaDiaPercent: number; allowAmortization: boolean; allowLateFee: boolean }> {
    const def = await this.defaults();
    const allowLateFee = b.allowLateFee ?? def.allowLateFee;
    return {
      ...b,
      allowAmortization: b.allowAmortization ?? def.allowAmortization,
      allowLateFee,
      multaDiaPercent: allowLateFee ? (b.multaDiaPercent ?? def.multaDiaPercent) : 0,
    };
  }

  /** Muda as opções de um empréstimo já liberado (ex.: perdoar a multa) e atualiza as parcelas em aberto. */
  async updateOptions(u: AuthUser, id: string, b: z.infer<typeof optionsSchema>) {
    const loan = await this.findOrThrow(u, id);
    if (loan.status !== 'ATIVO' && loan.status !== 'PERDA') throw new BadRequestException('Empréstimo encerrado: opções não podem mais ser alteradas');
    const allowLateFee = b.allowLateFee ?? loan.allowLateFee;
    const data = {
      allowAmortization: b.allowAmortization ?? loan.allowAmortization,
      allowLateFee,
      // a % fica guardada mesmo com a multa desligada, para religar sem perder o valor combinado
      multaDiaPercent: b.multaDiaPercent ?? (num(loan.multaDiaPercent) || (allowLateFee ? (await this.defaults()).multaDiaPercent : 0)),
    };
    const asOf = today();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.loan.update({ where: { id }, data, include: { installments: true } });
      const eLoan = toEngineLoan(updated);
      for (const i of updated.installments.filter((x) => x.status === 'PENDENTE')) {
        const v = viewInstallment(toEngineInstallment(i), eLoan, asOf);
        await tx.installment.update({ where: { id: i.id }, data: { updatedValue: d(v.updatedCents), diasAtraso: v.diasAtraso, multaDiaPercent: allowLateFee ? data.multaDiaPercent : 0 } });
      }
      await this.audit.log(u.id, 'UPDATE_OPTIONS', 'Loan', id, { before: { allowAmortization: loan.allowAmortization, allowLateFee: loan.allowLateFee, multaDiaPercent: num(loan.multaDiaPercent) }, after: data }, tx);
    });
    await this.score.recompute(loan.clientId);
    return this.detail(u, id);
  }

  scope(u: AuthUser): Prisma.LoanWhereInput {
    return isAdmin(u) ? {} : { lenderUserId: u.id };
  }

  async preview(raw: z.infer<typeof loanBase>) {
    const b = await this.withDefaults(raw);
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
    if (cl.status !== 'ATIVO')
      return { level: 'BLOCKED' as const, title: 'Ficha incompleta', message: 'Complete a ficha do cliente (Salvar Cliente Completo) antes de emprestar.' };
    return creditLockFor(cl, r);
  }

  async create(u: AuthUser, raw: z.infer<typeof createSchema>) {
    const b = await this.withDefaults(raw);
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
        // Dono/gestor empresta do próprio caixa (pode ficar negativo = capital investido líquido)
        await tx.user.update({
          where: { id: lenderId },
          data: { capitalDisponivel: { decrement: d(b.principalCents) }, capitalEmprestado: { increment: d(b.principalCents) } },
        });
      }
      const l = await tx.loan.create({
        data: {
          clientId: b.clientId,
          funderUserId: funderId,
          lenderUserId: lenderId,
          principal: d(b.principalCents),
          interestRate: b.ratePercent,
          multaDiaPercent: b.multaDiaPercent,
          allowAmortization: b.allowAmortization,
          allowLateFee: b.allowLateFee,
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
      await this.audit.log(u.id, 'CREATE', 'Loan', l.id, { principalCents: b.principalCents, lenderId, riskAcknowledged: !!b.riskAcknowledged, allowAmortization: b.allowAmortization, allowLateFee: b.allowLateFee }, tx);
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

  @Get('settings')
  defaults() {
    return this.loans.defaults();
  }

  @Roles('SUPER_ADMIN')
  @Put('settings')
  saveDefaults(@CurrentUser() u: AuthUser, @Body(new ZodPipe(defaultsSchema)) b: LoanDefaults) {
    return this.loans.saveDefaults(u, b);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id/options')
  options(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(optionsSchema)) b: z.infer<typeof optionsSchema>) {
    return this.loans.updateOptions(u, id, b);
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
