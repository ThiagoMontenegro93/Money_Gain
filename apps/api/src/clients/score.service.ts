import { Injectable, Logger } from '@nestjs/common';
import { computeScore, formatBRL, ISODate, ScoreResult, simulatePayoff } from '@lendcontrol/core';
import { AuditService } from '../common/audit.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { dt, iso, today } from '../common/util';
import { toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';

/**
 * Recalcula score / classificação / checkPerda de um cliente a partir das parcelas.
 * Chamado na aprovação de pagamentos, na criação de empréstimos e pelo cron 00:00.
 */
@Injectable()
export class ScoreService {
  private readonly logger = new Logger('Score');
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async evaluate(clientId: string, asOf: ISODate = today(), tx?: Tx): Promise<ScoreResult> {
    const db = tx ?? this.prisma;
    const loans = await db.loan.findMany({
      where: { clientId, status: { not: 'CANCELADO' } },
      include: { installments: true },
    });
    const lastPayment = await db.payment.findFirst({
      where: { loan: { clientId }, status: 'APROVADO' },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    });
    const active = loans.filter((l) => l.status === 'ATIVO' || l.status === 'PERDA');
    const firstRelease = active.map((l) => iso(l.releaseDate)!).sort()[0] ?? null;
    const result = computeScore({
      today: asOf,
      lastPaymentAt: iso(lastPayment?.paidAt),
      firstReleaseAt: firstRelease,
      installments: loans.flatMap((l) =>
        l.installments.map((i) => ({ dueDate: iso(i.dueDate)!, status: i.status, paidAt: iso(i.paidAt) })),
      ),
    });
    result.openDebtCents = active.reduce((s, l) => {
      const q = simulatePayoff(toEngineLoan(l), l.installments.map(toEngineInstallment), asOf);
      return s + (q?.amountCents ?? 0);
    }, 0);
    return result;
  }

  async recompute(clientId: string, asOf: ISODate = today(), tx?: Tx) {
    const db = tx ?? this.prisma;
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const r = await this.evaluate(clientId, asOf, db);
    const becamePerda = r.isPerda && client.classificacao !== 'PERDA';
    // Saiu da PERDA (voltou a pagar): remove o bloqueio automático (bloqueio manual permanece)
    const leftPerda = !r.isPerda && client.isBlocked && (client.blockedReason ?? '').startsWith('PERDA automática');
    await db.client.update({
      where: { id: clientId },
      data: {
        score: r.score,
        classificacao: r.classificacao,
        pontualidade: r.pontualidade,
        diasSemPagar: r.diasSemPagar,
        scoreUpdatedAt: new Date(),
        ...(becamePerda
          ? { isBlocked: true, blockedReason: `PERDA automática - ${r.diasSemPagar} dias sem pagamento`, unblockedAt: null }
          : leftPerda
            ? { isBlocked: false, blockedReason: null }
            : {}),
      },
    });
    if (leftPerda) {
      await db.loan.updateMany({ where: { clientId, status: 'PERDA' }, data: { status: 'ATIVO' } });
      await db.clientHistory.create({ data: { clientId, type: 'SAIU_PERDA', message: `Cliente voltou a pagar - bloqueio automático removido (score ${r.score}/10)` } });
    }
    if (r.isPerda) {
      await db.loan.updateMany({ where: { clientId, status: 'ATIVO' }, data: { status: 'PERDA' } });
    }
    if (becamePerda) {
      const msg = `Cliente ${client.fullName} virou PERDA - ${r.diasSemPagar} dias sem pagamento - ${formatBRL(r.openDebtCents)}`;
      this.logger.warn(msg);
      await db.clientHistory.create({ data: { clientId, type: 'VIROU_PERDA', message: msg } });
      await this.audit.notifyAdmins('Cliente virou PERDA', msg, { clientId }, db);
    } else if (client.classificacao !== r.classificacao) {
      await db.clientHistory.create({
        data: { clientId, type: 'SCORE', message: `Classificação: ${client.classificacao} → ${r.classificacao} (score ${r.score}/10)` },
      });
    }
    return r;
  }

  /** Recalcula todos os clientes com empréstimos ativos (cron). */
  async recomputeAll(asOf: ISODate = today()) {
    const clients = await this.prisma.client.findMany({
      where: { deletedAt: null, loans: { some: { status: { in: ['ATIVO', 'PERDA'] } } } },
      select: { id: true },
    });
    for (const cl of clients) {
      try {
        await this.recompute(cl.id, asOf);
      } catch (e) {
        this.logger.error(`Falha ao recalcular score do cliente ${cl.id}: ${(e as Error).message}`);
      }
    }
    return clients.length;
  }

  static firstLoanDate(loans: { releaseDate: Date }[]) {
    return loans.map((l) => l.releaseDate).sort((a, b) => a.getTime() - b.getTime())[0] ?? dt(today());
  }
}
