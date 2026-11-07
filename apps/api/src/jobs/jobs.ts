import { Controller, Injectable, Logger, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { daysLate, viewInstallment } from '@lendcontrol/core';
import { AuditService } from '../common/audit.service';
import { IDEMPOTENCY_RETENTION_DAYS } from '../common/idempotency.interceptor';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { d, today } from '../common/util';
import { ScoreService } from '../clients/score.service';
import { toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';

/**
 * Cron 00:00 (America/Sao_Paulo): atualiza multa diária / dias de atraso das parcelas
 * vencidas e recalcula score + checkPerda de todos os clientes com empréstimo ativo.
 * Idempotente: pode rodar várias vezes no mesmo dia sem efeito colateral.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');
  private running = false;
  constructor(
    private prisma: PrismaService,
    private score: ScoreService,
    private audit: AuditService,
  ) {}

  @Cron('0 0 * * *', { timeZone: 'America/Sao_Paulo', name: 'daily-late-fees' })
  async nightly() {
    await this.run('cron');
  }

  async run(trigger: string) {
    if (this.running) return { skipped: true };
    this.running = true;
    const started = Date.now();
    try {
      const asOf = today();
      const loans = await this.prisma.loan.findMany({ where: { status: { in: ['ATIVO', 'PERDA'] } }, include: { installments: true } });
      let updated = 0;
      for (const l of loans) {
        const eLoan = toEngineLoan(l);
        for (const i of l.installments) {
          if (i.status !== 'PENDENTE') continue;
          const v = viewInstallment(toEngineInstallment(i), eLoan, asOf);
          if (v.diasAtraso !== i.diasAtraso || v.updatedCents !== Math.round(Number(i.updatedValue) * 100)) {
            await this.prisma.installment.update({ where: { id: i.id }, data: { diasAtraso: daysLate(v.dueDate, asOf), updatedValue: d(v.updatedCents) } });
            updated++;
          }
        }
      }
      const clients = await this.score.recomputeAll(asOf);
      // Fase 4: chaves de idempotência da fila offline ficam retidas por 7 dias
      const { count: idempotencyPurged } = await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_RETENTION_DAYS * 86_400_000) } } });
      const result = { asOf, loans: loans.length, installmentsUpdated: updated, clientsScored: clients, idempotencyPurged, ms: Date.now() - started };
      this.logger.log(`Rotina diária (${trigger}): ${JSON.stringify(result)}`);
      await this.audit.log(null, 'DAILY_JOB', 'System', null, { trigger, ...result });
      return result;
    } catch (e) {
      this.logger.error(`Rotina diária falhou: ${(e as Error).stack}`);
      throw e;
    } finally {
      this.running = false;
    }
  }
}

@Controller('jobs')
export class JobsController {
  constructor(private jobs: JobsService) {}

  /** Execução manual (Super Admin) da rotina de multa/score. */
  @Roles('SUPER_ADMIN')
  @Post('daily/run')
  run(@CurrentUser() u: AuthUser) {
    return this.jobs.run(`manual:${u.id}`);
  }
}
