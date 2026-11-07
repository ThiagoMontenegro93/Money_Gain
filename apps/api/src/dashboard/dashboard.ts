import { Controller, Get, Injectable, Param, Post } from '@nestjs/common';
import { addDays, simulatePayoff, viewInstallment } from '@lendcontrol/core';
import { AuthUser, CurrentUser, isAdmin, Public } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { c, iso, today } from '../common/util';
import { ClientsService } from '../clients/clients.service';
import { toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private clients: ClientsService,
  ) {}

  async get(u: AuthUser) {
    const asOf = today();
    const admin = isAdmin(u);
    const loanScope = admin ? {} : { lenderUserId: u.id };
    const loans = await this.prisma.loan.findMany({
      where: { ...loanScope, status: { in: ['ATIVO', 'PERDA'] } },
      include: { installments: true, client: { select: { fullName: true } } },
    });
    let totalEmprestado = 0, totalAReceber = 0, totalPerda = 0;
    const upcoming: { loanId: string; clientName: string; dueDate: string; valueCents: number; number: number }[] = [];
    const limit = addDays(asOf, 7);
    for (const l of loans) {
      const eLoan = toEngineLoan(l);
      const eInst = l.installments.map(toEngineInstallment);
      totalEmprestado += eLoan.saldoDevedorCents;
      const payoff = simulatePayoff(eLoan, eInst, asOf)?.amountCents ?? 0;
      totalAReceber += payoff;
      if (l.status === 'PERDA') totalPerda += payoff;
      for (const i of eInst.filter((x) => x.status === 'PENDENTE' && x.dueDate <= limit)) {
        upcoming.push({ loanId: l.id, clientName: l.client.fullName, dueDate: i.dueDate, valueCents: viewInstallment(i, eLoan, asOf).updatedCents, number: i.number });
      }
    }
    // Atrasadas primeiro (mais antigas), depois os próximos 7 dias
    upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const monthStart = asOf.slice(0, 8) + '01';
    const paidMonth = await this.prisma.payment.aggregate({
      where: { status: 'APROVADO', paidAt: { gte: new Date(monthStart) }, ...(admin ? {} : { loan: { lenderUserId: u.id } }) },
      _sum: { interestPart: true, finePart: true, extraPart: true },
    });
    const users = await this.prisma.user.findMany({ where: admin ? { role: 'OPERATOR' } : { id: u.id } });
    const capComFunc = users.reduce((s, x) => s + c(x.capitalDisponivel) + c(x.capitalEmprestado), 0);
    const repasse = users.reduce((s, x) => s + c(x.paraRepassar), 0);
    const comissao = users.reduce((s, x) => s + c(x.comissaoAPagar), 0);
    const disponivelFunc = users.reduce((s, x) => s + c(x.capitalDisponivel), 0);

    const { items, counts } = await this.clients.list(u, {});
    const withHistory = items.filter((x) => x.pontualidade !== null);
    const topBons = withHistory.filter((x) => x.classificacao === 'BOM').sort((a, b) => b.score - a.score || (b.pontualidade ?? 0) - (a.pontualidade ?? 0)).slice(0, 5);
    const topPiores = items.filter((x) => x.classificacao === 'PERDA' || x.classificacao === 'RUIM' || (x.classificacao === 'REGULAR' && x.overdueCount > 0))
      .sort((a, b) => a.score - b.score || b.emAbertoCents - a.emAbertoCents).slice(0, 5);

    const [pPay, pTr] = await Promise.all([
      this.prisma.payment.count({ where: { status: 'AGUARDANDO_APROVACAO', ...(admin ? {} : { createdById: u.id }) } }),
      this.prisma.capitalTransfer.count({ where: { status: 'AGUARDANDO_APROVACAO', ...(admin ? {} : { fromUserId: u.id }) } }),
    ]);
    return {
      asOf,
      capitalTotalCents: totalEmprestado + disponivelFunc + repasse,
      capitalComFuncionariosCents: capComFunc,
      totalEmprestadoCents: totalEmprestado,
      totalAReceberCents: totalAReceber,
      totalEmPerdaCents: totalPerda,
      jurosRecebidosMesCents: c(paidMonth._sum.interestPart) + c(paidMonth._sum.finePart) + c(paidMonth._sum.extraPart),
      repassePendenteCents: repasse,
      comissaoAPagarCents: comissao,
      pendingApprovals: { payments: pPay, transfers: pTr },
      scoreCounts: { BOM: counts.BOM, REGULAR: counts.REGULAR, RUIM: counts.RUIM, PERDA: counts.PERDA },
      overdueClients: counts.atrasados,
      totalClients: counts.all,
      activeLoans: loans.length,
      topBons,
      topPiores,
      upcoming: upcoming.slice(0, 20),
    };
  }
}

@Controller()
export class DashboardController {
  constructor(
    private dash: DashboardService,
    private prisma: PrismaService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', version: '6.5.0', time: new Date().toISOString(), today: today() };
  }

  @Get('dashboard')
  get(@CurrentUser() u: AuthUser) {
    return this.dash.get(u);
  }

  @Get('notifications')
  async notifications(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.notification.findMany({
      where: { OR: [{ userId: u.id }, ...(u.role === 'SUPER_ADMIN' ? [{ role: 'SUPER_ADMIN' as const }] : [])] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((n) => ({ id: n.id, title: n.title, message: n.message, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }));
  }

  @Post('notifications/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({
      where: { id, OR: [{ userId: u.id }, ...(u.role === 'SUPER_ADMIN' ? [{ role: 'SUPER_ADMIN' as const }] : [])] },
      data: { readAt: new Date() },
    });
    return { ok: true, at: iso(new Date()) };
  }
}
