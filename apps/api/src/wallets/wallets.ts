import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { formatBRL } from '@lendcontrol/core';
import { CapitalTransfer, TransferStatus, TransferType } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth';
import { PrismaService, Tx } from '../common/prisma.service';
import { c, d, ref, ZodPipe } from '../common/util';
import { toUserDTO, UsersService } from '../users/users';

const createSchema = z.object({
  type: z.nativeEnum(TransferType),
  valueCents: z.number().int().positive(),
  toUserId: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

type TransferWith = CapitalTransfer & { from: { id: string; name: string }; to: { id: string; name: string }; approvedBy: { id: string; name: string } | null };
const include = { from: { select: { id: true, name: true } }, to: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } } as const;

function transferDTO(t: TransferWith) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    valueCents: c(t.value),
    notes: t.notes,
    from: ref(t.from)!,
    to: ref(t.to)!,
    approvedBy: ref(t.approvedBy),
    approvedAt: t.approvedAt?.toISOString() ?? null,
    rejectionReason: t.rejectionReason,
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class WalletsService {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private audit: AuditService,
  ) {}

  private async owner() {
    const o = await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!o) throw new NotFoundException('Dono (Super Admin) não cadastrado');
    return o;
  }

  /** Efetiva o repasse dentro da transação, com débito condicional (sem saldo negativo). */
  private async settle(tx: Tx, t: CapitalTransfer, approverId: string) {
    const v = d(c(t.value));
    const desc = (s: string) => `${s} - ${formatBRL(c(t.value))}${t.notes ? ` (${t.notes})` : ''}`;
    switch (t.type) {
      case 'REPASSE_CAPITAL': {
        await tx.user.update({ where: { id: t.toUserId }, data: { capitalDisponivel: { increment: v } } });
        await tx.user.update({ where: { id: t.fromUserId }, data: { capitalDisponivel: { decrement: v } } });
        await tx.cashLedger.createMany({
          data: [
            { userId: t.toUserId, type: 'REPASSE_CAPITAL', amount: v, description: desc('Capital recebido do dono'), transferId: t.id },
            { userId: t.fromUserId, type: 'REPASSE_CAPITAL', amount: v.neg(), description: desc('Capital repassado ao funcionário'), transferId: t.id },
          ],
        });
        break;
      }
      case 'REPASSE_LUCRO':
      case 'DEVOLUCAO_CAPITAL': {
        const field = t.type === 'REPASSE_LUCRO' ? 'paraRepassar' : 'capitalDisponivel';
        const r = await tx.user.updateMany({ where: { id: t.fromUserId, [field]: { gte: v } }, data: { [field]: { decrement: v } } });
        if (r.count !== 1) throw new BadRequestException('Saldo insuficiente na carteira do funcionário para este repasse');
        await tx.user.update({ where: { id: t.toUserId }, data: { capitalDisponivel: { increment: v } } });
        const label = t.type === 'REPASSE_LUCRO' ? 'Repasse para o dono' : 'Devolução de capital ao dono';
        await tx.cashLedger.createMany({
          data: [
            { userId: t.fromUserId, type: t.type, amount: v.neg(), description: desc(label), transferId: t.id },
            { userId: t.toUserId, type: t.type, amount: v, description: desc(`${label} recebido`), transferId: t.id },
          ],
        });
        break;
      }
      case 'PAGAMENTO_COMISSAO': {
        const r = await tx.user.updateMany({ where: { id: t.toUserId, comissaoAPagar: { gte: v } }, data: { comissaoAPagar: { decrement: v } } });
        if (r.count !== 1) throw new BadRequestException('Valor maior que a comissão a pagar');
        await tx.user.update({ where: { id: t.fromUserId }, data: { capitalDisponivel: { decrement: v } } });
        await tx.cashLedger.createMany({
          data: [
            { userId: t.toUserId, type: 'PAGAMENTO_COMISSAO', amount: v, description: desc('Comissão recebida'), transferId: t.id },
            { userId: t.fromUserId, type: 'PAGAMENTO_COMISSAO', amount: v.neg(), description: desc('Comissão paga'), transferId: t.id },
          ],
        });
        break;
      }
    }
    return tx.capitalTransfer.update({ where: { id: t.id }, data: { status: 'APROVADO', approvedById: approverId, approvedAt: new Date() }, include });
  }

  async create(u: AuthUser, b: z.infer<typeof createSchema>) {
    const owner = await this.owner();
    if (b.type === 'REPASSE_CAPITAL' || b.type === 'PAGAMENTO_COMISSAO') {
      if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Só o dono repassa capital ou paga comissão');
      if (!b.toUserId) throw new BadRequestException('Informe o funcionário');
      const to = await this.prisma.user.findUnique({ where: { id: b.toUserId } });
      if (!to || to.role !== 'OPERATOR') throw new BadRequestException('Destino deve ser um funcionário (OPERATOR)');
      const t = await this.prisma.$transaction(async (tx) => {
        const created = await tx.capitalTransfer.create({ data: { fromUserId: u.id, toUserId: to.id, type: b.type, value: d(b.valueCents), notes: b.notes } });
        return this.settle(tx, created, u.id);
      });
      await this.audit.log(u.id, 'CREATE', 'CapitalTransfer', t.id, { type: b.type, valueCents: b.valueCents, to: to.id });
      return transferDTO(t);
    }
    // REPASSE_LUCRO / DEVOLUCAO_CAPITAL: funcionário -> dono, aguarda aprovação
    if (u.role !== 'OPERATOR') throw new ForbiddenException('Repasse para o dono é feito pelo funcionário');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const available = b.type === 'REPASSE_LUCRO' ? c(me.paraRepassar) : c(me.capitalDisponivel);
    const pending = await this.prisma.capitalTransfer.aggregate({ where: { fromUserId: u.id, type: b.type, status: 'AGUARDANDO_APROVACAO' }, _sum: { value: true } });
    if (b.valueCents + c(pending._sum.value) > available)
      throw new BadRequestException(`Valor acima do disponível (${formatBRL(available - c(pending._sum.value))} considerando repasses pendentes)`);
    const t = await this.prisma.capitalTransfer.create({ data: { fromUserId: u.id, toUserId: owner.id, type: b.type, value: d(b.valueCents), notes: b.notes }, include });
    await this.audit.log(u.id, 'CREATE', 'CapitalTransfer', t.id, { type: b.type, valueCents: b.valueCents });
    await this.audit.notifyAdmins('Repasse aguardando aprovação', `${u.name} solicitou ${b.type === 'REPASSE_LUCRO' ? 'repasse' : 'devolução de capital'} de ${formatBRL(b.valueCents)}`, { transferId: t.id });
    return transferDTO(t);
  }

  async approve(u: AuthUser, id: string, password: string) {
    await this.users.verifyPassword(u.id, password);
    const t = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.capitalTransfer.updateMany({ where: { id, status: 'AGUARDANDO_APROVACAO' }, data: { approvedById: u.id } });
      if (claimed.count !== 1) throw new ConflictException('Repasse já processado ou inexistente');
      const tr = await tx.capitalTransfer.findUniqueOrThrow({ where: { id } });
      if (tr.fromUserId === u.id) throw new ForbiddenException('Você não pode aprovar o próprio repasse');
      return this.settle(tx, tr, u.id);
    });
    await this.audit.log(u.id, 'APPROVE', 'CapitalTransfer', id);
    return transferDTO(t);
  }

  async reject(u: AuthUser, id: string, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Informe o motivo');
    const r = await this.prisma.capitalTransfer.updateMany({ where: { id, status: 'AGUARDANDO_APROVACAO' }, data: { status: 'REJEITADO', rejectionReason: reason.trim(), approvedById: u.id, approvedAt: new Date() } });
    if (r.count !== 1) throw new ConflictException('Repasse já processado ou inexistente');
    await this.audit.log(u.id, 'REJECT', 'CapitalTransfer', id, { reason });
    return transferDTO(await this.prisma.capitalTransfer.findUniqueOrThrow({ where: { id }, include }));
  }

  async list(u: AuthUser, status?: TransferStatus) {
    const rows = await this.prisma.capitalTransfer.findMany({
      where: { ...(isAdmin(u) ? {} : { OR: [{ fromUserId: u.id }, { toUserId: u.id }] }), ...(status ? { status } : {}) },
      include,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(transferDTO);
  }

  async wallets(u: AuthUser) {
    const rows = await this.prisma.user.findMany({ where: isAdmin(u) ? { role: 'OPERATOR' } : { id: u.id }, orderBy: { name: 'asc' } });
    return rows.map(toUserDTO);
  }

  async ledger(u: AuthUser, userId?: string) {
    const target = isAdmin(u) && userId ? userId : u.id;
    const rows = await this.prisma.cashLedger.findMany({ where: { userId: target }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({
      id: r.id, type: r.type, amountCents: c(r.amount), description: r.description, createdAt: r.createdAt.toISOString(),
      loanId: r.loanId, paymentId: r.paymentId, transferId: r.transferId,
    }));
  }
}

@Controller()
export class WalletsController {
  constructor(private w: WalletsService) {}

  @Get('wallets')
  wallets(@CurrentUser() u: AuthUser) {
    return this.w.wallets(u);
  }

  @Get('ledger')
  ledger(@CurrentUser() u: AuthUser, @Query('userId') userId?: string) {
    return this.w.ledger(u, userId || undefined);
  }

  @Post('transfers')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.w.create(u, b);
  }

  @Get('transfers')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: TransferStatus) {
    return this.w.list(u, status || undefined);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('transfers/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ password: z.string() }))) b: { password: string }) {
    return this.w.approve(u, id, b.password);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('transfers/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string() }))) b: { reason: string }) {
    return this.w.reject(u, id, b.reason);
  }
}
