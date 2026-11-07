import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { expectedAmount, formatBRL, isValidISODate, planPayment, diffDays } from '@lendcontrol/core';
import { PaymentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { d, dt, iso, num, today, ZodPipe } from '../common/util';
import { ScoreService } from '../clients/score.service';
import { loanInclude, paymentDTO, paymentInclude, toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';
import { UsersService } from '../users/users';
import { MessagingService } from '../messaging/messaging.service';

const createSchema = z.object({
  loanId: z.string(),
  type: z.enum(['JUROS', 'QUITACAO', 'AMORTIZACAO', 'PARCELA']),
  amountCents: z.number().int().positive(),
  paidAt: z.string().refine(isValidISODate, 'Data inválida'),
  installmentNumber: z.number().int().positive().optional(),
  comprovanteFileId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private score: ScoreService,
    private audit: AuditService,
    private messaging: MessagingService,
  ) {}

  private async loadLoan(u: AuthUser, loanId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, ...(isAdmin(u) ? {} : { lenderUserId: u.id }) },
      include: loanInclude,
    });
    if (!loan) throw new NotFoundException('Empréstimo não encontrado');
    return loan;
  }

  /** Operador lança recibo -> AGUARDANDO_APROVACAO. Nada é baixado até a aprovação. */
  async create(u: AuthUser, b: z.infer<typeof createSchema>) {
    const loan = await this.loadLoan(u, b.loanId);
    if (diffDays(b.paidAt, today()) > 0) throw new BadRequestException('Data do pagamento não pode ser futura');
    if (b.paidAt < iso(loan.releaseDate)!) throw new BadRequestException('Data do pagamento anterior à liberação do empréstimo');
    if (u.role === 'OPERATOR' && !b.comprovanteFileId)
      throw new BadRequestException({ message: 'Anexe o comprovante PIX do cliente', code: 'PROOF_REQUIRED' });
    if (b.comprovanteFileId) {
      const f = await this.prisma.storedFile.findUnique({ where: { id: b.comprovanteFileId } });
      if (!f || (!isAdmin(u) && f.uploadedById !== u.id)) throw new BadRequestException('Comprovante não encontrado (faça o upload novamente)');
    }
    const pending = await this.prisma.payment.count({ where: { loanId: loan.id, status: 'AGUARDANDO_APROVACAO' } });
    if (pending) throw new ConflictException({ message: 'Já existe um recibo aguardando aprovação neste empréstimo', code: 'PENDING_EXISTS' });

    const eLoan = toEngineLoan(loan);
    const eInst = loan.installments.map(toEngineInstallment);
    // Validação antecipada (dry-run): o mesmo cálculo será refeito na aprovação
    const plan = planPayment(eLoan, eInst, { type: b.type, amountCents: b.amountCents, asOf: b.paidAt, installmentNumber: b.installmentNumber });
    const expected = b.type === 'AMORTIZACAO' ? b.amountCents : expectedAmount(eLoan, eInst, b.type, b.paidAt);
    const installment = plan.installmentNumber ? loan.installments.find((i) => i.number === plan.installmentNumber) : null;

    const p = await this.prisma.payment
      .create({
      data: {
        loanId: loan.id,
        installmentId: installment?.id,
        type: b.type,
        value: d(b.amountCents),
        expectedValue: expected === null ? null : d(expected),
        paidAt: dt(b.paidAt),
        comprovanteFileId: b.comprovanteFileId,
        notes: b.notes,
        createdById: u.id,
      },
      include: paymentInclude,
    })
      .catch((e: unknown) => {
        // Índice único parcial: 1 recibo pendente por empréstimo (protege contra duplo clique / concorrência)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new ConflictException({ message: 'Já existe um recibo aguardando aprovação neste empréstimo', code: 'PENDING_EXISTS' });
        throw e;
      });
    await this.audit.log(u.id, 'CREATE', 'Payment', p.id, { type: b.type, amountCents: b.amountCents });
    await this.audit.notifyAdmins('Recibo aguardando aprovação', `${u.name} lançou ${b.type} de ${formatBRL(b.amountCents)} - ${loan.client.fullName}`, { paymentId: p.id });
    return paymentDTO(p);
  }

  async list(u: AuthUser, q: { status?: PaymentStatus; loanId?: string }) {
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(isAdmin(u) ? {} : { loan: { lenderUserId: u.id } }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.loanId ? { loanId: q.loanId } : {}),
      },
      include: paymentInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(paymentDTO);
  }

  /**
   * Aprovação (Admin, com reconfirmação de senha): aplica o motor, baixa parcelas,
   * atualiza razão de caixa, carteira do funcionário, comissão e score.
   */
  async approve(u: AuthUser, id: string, password: string) {
    await this.users.verifyPassword(u.id, password);
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    if (payment.status !== 'AGUARDANDO_APROVACAO') throw new ConflictException('Este recibo já foi processado');
    if (payment.createdById === u.id && u.role !== 'SUPER_ADMIN')
      throw new ForbiddenException({ message: 'Você não pode aprovar o próprio lançamento', code: 'SELF_APPROVAL' });

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Trava pessimista do empréstimo para evitar aprovações concorrentes
        await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${payment.loanId} FOR UPDATE`;
        const claimed = await tx.payment.updateMany({ where: { id, status: 'AGUARDANDO_APROVACAO' }, data: { approvedById: u.id } });
        if (claimed.count !== 1) throw new ConflictException('Este recibo já foi processado');

        const loan = await tx.loan.findUniqueOrThrow({ where: { id: payment.loanId }, include: { installments: true, lender: true } });
        const eLoan = toEngineLoan(loan);
        const plan = planPayment(eLoan, loan.installments.map(toEngineInstallment), {
          type: payment.type,
          amountCents: Math.round(num(payment.value) * 100),
          asOf: iso(payment.paidAt)!,
        });

        const byNumber = new Map(loan.installments.map((i) => [i.number, i]));
        for (const upd of plan.updates) {
          const inst = byNumber.get(upd.number)!;
          const ch = upd.changes;
          const data: Prisma.InstallmentUpdateInput = {};
          if (ch.status) data.status = ch.status;
          if (ch.paidCents !== undefined && ch.paidCents !== null) data.paidValue = d(ch.paidCents);
          if (ch.paidAt) data.paidAt = dt(ch.paidAt);
          if (ch.paidKind) data.paidKind = ch.paidKind;
          if (ch.type) data.type = ch.type;
          if (ch.isProjection !== undefined) data.isProjection = ch.isProjection;
          if (ch.principalCents !== undefined) data.principalValue = d(ch.principalCents);
          if (ch.interestCents !== undefined) data.interestValue = d(ch.interestCents);
          if (ch.originalCents !== undefined) {
            data.originalValue = d(ch.originalCents);
            data.updatedValue = d(ch.originalCents);
          }
          if (ch.status === 'PAGA' || ch.status === 'CANCELADA') data.diasAtraso = 0;
          await tx.installment.update({ where: { id: inst.id }, data });
        }
        if (plan.creates.length) {
          await tx.installment.createMany({
            data: plan.creates.map((i) => ({
              loanId: loan.id,
              number: i.number,
              dueDate: dt(i.dueDate),
              principalValue: d(i.principalCents),
              interestValue: d(i.interestCents),
              originalValue: d(i.originalCents),
              updatedValue: d(i.originalCents),
              multaDiaPercent: loan.multaDiaPercent,
              type: i.type,
              isProjection: i.isProjection,
            })),
          });
        }
        const lc = plan.loanChanges;
        const newStatus = lc.status ?? (loan.status === 'PERDA' ? 'ATIVO' : loan.status);
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            ...(lc.saldoDevedorCents !== undefined ? { saldoDevedor: d(lc.saldoDevedorCents) } : {}),
            status: newStatus,
            ...(lc.quitadoEm ? { quitadoEm: dt(lc.quitadoEm) } : {}),
            version: { increment: 1 },
          },
        });

        // ---- Carteira / razão de caixa ----
        const a = plan.allocation;
        const revenue = a.interestCents + a.fineCents + a.extraCents;
        const amount = Math.round(num(payment.value) * 100);
        const lender = loan.lender;
        const isOperator = lender.role === 'OPERATOR';
        const commission = isOperator ? Math.round((revenue * num(lender.commissionPercent)) / 100) : 0;
        const tag = `Empréstimo #${loan.code}`;
        if (isOperator) {
          await tx.user.update({
            where: { id: lender.id },
            data: {
              recebidoClientes: { increment: d(amount) },
              capitalEmprestado: { decrement: d(a.principalCents) },
              // Revolving: o principal volta para o funcionário re-emprestar; senão vai para o dono
              ...(lender.revolving
                ? { capitalDisponivel: { increment: d(a.principalCents) }, paraRepassar: { increment: d(revenue) } }
                : { paraRepassar: { increment: d(revenue + a.principalCents) } }),
              comissaoAPagar: { increment: d(commission) },
            },
          });
        } else {
          await tx.user.update({
            where: { id: lender.id },
            data: {
              recebidoClientes: { increment: d(amount) },
              capitalEmprestado: { decrement: d(a.principalCents) },
              capitalDisponivel: { increment: d(amount) },
            },
          });
        }
        const entries: Prisma.CashLedgerCreateManyInput[] = [];
        const base = { userId: lender.id, loanId: loan.id, paymentId: id };
        if (a.principalCents) entries.push({ ...base, type: 'ENTRADA_PRINCIPAL', amount: d(a.principalCents), description: `${tag} - principal` });
        if (a.interestCents + a.extraCents) entries.push({ ...base, type: 'ENTRADA_JUROS', amount: d(a.interestCents + a.extraCents), description: `${tag} - juros` });
        if (a.fineCents) entries.push({ ...base, type: 'ENTRADA_MULTA', amount: d(a.fineCents), description: `${tag} - multa por atraso` });
        if (commission) entries.push({ ...base, type: 'COMISSAO', amount: d(commission), description: `${tag} - comissão ${num(lender.commissionPercent)}% sobre juros/multa (a receber do dono)` });
        if (entries.length) await tx.cashLedger.createMany({ data: entries });

        const updated = await tx.payment.update({
          where: { id },
          data: {
            status: 'APROVADO',
            approvedById: u.id,
            approvedAt: new Date(),
            installmentId: plan.installmentNumber ? byNumber.get(plan.installmentNumber)?.id : payment.installmentId,
            principalPart: d(a.principalCents),
            interestPart: d(a.interestCents),
            finePart: d(a.fineCents),
            extraPart: d(a.extraCents),
            commissionPart: d(commission),
            resultMessage: plan.message,
          },
          include: paymentInclude,
        });
        await tx.client.update({ where: { id: loan.clientId }, data: { lastPaymentAt: payment.paidAt } });
        await this.audit.log(u.id, 'APPROVE', 'Payment', id, { allocation: a, commission, message: plan.message }, tx);
        return { updated, clientId: loan.clientId };
      },
      { isolationLevel: 'ReadCommitted', timeout: 20_000 },
    );
    await this.score.recompute(result.clientId);
    this.logger.log(`Pagamento ${id} aprovado por ${u.name}: ${result.updated.resultMessage}`);
    // Confirmação "Pagamento OK" via WhatsApp (não bloqueia a aprovação)
    await this.messaging.paymentOk(id).catch((e) => this.logger.warn(`Falha ao enfileirar Payment OK: ${(e as Error).message}`));
    return paymentDTO(result.updated);
  }

  async reject(u: AuthUser, id: string, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Informe o motivo da rejeição');
    const r = await this.prisma.payment.updateMany({
      where: { id, status: 'AGUARDANDO_APROVACAO' },
      data: { status: 'REJEITADO', rejectionReason: reason.trim(), approvedById: u.id, approvedAt: new Date() },
    });
    if (r.count !== 1) throw new ConflictException('Este recibo já foi processado');
    await this.audit.log(u.id, 'REJECT', 'Payment', id, { reason });
    return paymentDTO(await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude }));
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.payments.create(u, b);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: PaymentStatus, @Query('loanId') loanId?: string) {
    return this.payments.list(u, { status: status || undefined, loanId: loanId || undefined });
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ password: z.string() }))) b: { password: string }) {
    return this.payments.approve(u, id, b.password);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string() }))) b: { reason: string }) {
    return this.payments.reject(u, id, b.reason);
  }
}
