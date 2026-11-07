import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DEFAULT_TEMPLATES,
  formatBRL,
  isoToBR,
  isValidPhone,
  msUntilWindow,
  normalizePhone,
  renderTemplate,
  simulatePayoff,
  TEMPLATE_META,
  TemplateKey,
  TemplateVars,
  templateForDue,
  viewInstallment,
  waLink,
} from '@lendcontrol/core';
import { MessageLog, Prisma } from '@prisma/client';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { c, today } from '../common/util';
import { toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';
import { DEFAULT_WA_CONFIG, ProviderError, sendViaProvider, WhatsAppConfig } from './providers';

const QUEUE = 'whatsapp';
const MAX_ATTEMPTS = 3;

/**
 * Mensagens WhatsApp pré-programadas (seção 4).
 * - Cron 09:00 (America/Sao_Paulo) gera os avisos D-2, D0, D+1, D+3, D+7 (+ fiador).
 * - Fila BullMQ (Redis) com 3 tentativas e backoff exponencial; respeita a janela 08:00-20:00.
 * - Idempotência por dedupeKey (parcela + template + dia). Sem Redis, processa em memória.
 * - Fallback: se o provedor falhar ou o canal for manual, gera link wa.me para envio com 1 clique.
 */
@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WhatsApp');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private crypto: CryptoService,
    private audit: AuditService,
  ) {}

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url || process.env.DISABLE_QUEUE === '1') {
      this.logger.warn('REDIS_URL não definido: mensagens processadas sem fila persistente');
      return;
    }
    const connection = { url, maxRetriesPerRequest: null as null };
    this.queue = new Queue(QUEUE, { connection, defaultJobOptions: { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    this.worker = new Worker(QUEUE, (job, token) => this.process(job, token), { connection, concurrency: 2, limiter: { max: 20, duration: 60_000 } });
    this.worker.on('failed', (job, err) => this.logger.warn(`Job ${job?.id} falhou (${job?.attemptsMade}/${MAX_ATTEMPTS}): ${err.message}`));
    this.worker.on('error', (err) => this.logger.error(`Worker: ${err.message}`));
    this.logger.log('Fila BullMQ "whatsapp" ativa');
  }

  /** Saúde do Redis da fila: 'off' sem fila configurada, 'erro' se não responder ao PING em 2 s. */
  async redisStatus(): Promise<'ok' | 'off' | 'erro'> {
    if (!this.queue) return 'off';
    try {
      const client = await this.queue.client;
      const pong = await Promise.race([client.ping(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
      return pong === 'PONG' ? 'ok' : 'erro';
    } catch {
      return 'erro';
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  // -------------------------------------------------------------------------
  // Configuração e templates
  // -------------------------------------------------------------------------

  config() {
    return this.settings.get<WhatsAppConfig>('whatsapp.config', DEFAULT_WA_CONFIG);
  }

  async publicConfig() {
    const { apiKeyEnc, metaTokenEnc, ...rest } = await this.config();
    return { ...rest, hasApiKey: !!apiKeyEnc, hasMetaToken: !!metaTokenEnc, queue: this.queue ? 'BULLMQ' : 'MEMORIA' };
  }

  async saveConfig(u: AuthUser, body: Partial<WhatsAppConfig> & { apiKey?: string | null; metaToken?: string | null }) {
    const cur = await this.config();
    const { apiKey, metaToken, ...rest } = body;
    const next: WhatsAppConfig = { ...cur, ...rest, blacklist: (rest.blacklist ?? cur.blacklist).map(normalizePhone).filter(Boolean) };
    if (apiKey !== undefined) next.apiKeyEnc = apiKey ? this.crypto.encrypt(apiKey) : null;
    if (metaToken !== undefined) next.metaTokenEnc = metaToken ? this.crypto.encrypt(metaToken) : null;
    await this.settings.set('whatsapp.config', next);
    await this.audit.log(u.id, 'UPDATE', 'Setting', 'whatsapp.config', { provider: next.provider, enabled: next.enabled });
    return this.publicConfig();
  }

  async templates(): Promise<Record<TemplateKey, string>> {
    return this.settings.get<Record<TemplateKey, string>>('whatsapp.templates', { ...DEFAULT_TEMPLATES });
  }

  async listTemplates() {
    const t = await this.templates();
    return (Object.keys(DEFAULT_TEMPLATES) as TemplateKey[]).map((key) => ({ key, ...TEMPLATE_META[key], text: t[key], isDefault: t[key] === DEFAULT_TEMPLATES[key] }));
  }

  async saveTemplate(u: AuthUser, key: TemplateKey, text: string | null) {
    if (!(key in DEFAULT_TEMPLATES)) throw new BadRequestException('Template inválido');
    const t = await this.templates();
    t[key] = text?.trim() ? text.trim() : DEFAULT_TEMPLATES[key];
    await this.settings.set('whatsapp.templates', t);
    await this.audit.log(u.id, 'UPDATE', 'Setting', `whatsapp.template.${key}`);
    return this.listTemplates();
  }

  // -------------------------------------------------------------------------
  // Variáveis
  // -------------------------------------------------------------------------

  private async pixKeyFor(lenderId: string) {
    const lender = await this.prisma.user.findUnique({ where: { id: lenderId }, select: { pixKey: true } });
    if (lender?.pixKey) return lender.pixKey;
    const owner = await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' }, select: { pixKey: true } });
    return owner?.pixKey ?? '(consulte seu atendente)';
  }

  private firstName(full: string) {
    return full.trim().split(/\s+/)[0] ?? full;
  }

  // -------------------------------------------------------------------------
  // Enfileiramento
  // -------------------------------------------------------------------------

  private isBlacklisted(cfg: WhatsAppConfig, phone: string) {
    return cfg.blacklist.includes(normalizePhone(phone));
  }

  async enqueue(data: {
    template: TemplateKey;
    phone: string;
    toName?: string | null;
    body: string;
    clientId?: string | null;
    loanId?: string | null;
    installmentId?: string | null;
    paymentId?: string | null;
    dedupeKey?: string | null;
    createdById?: string | null;
    optOut?: boolean;
  }): Promise<MessageLog | null> {
    const cfg = await this.config();
    const link = waLink(data.phone, data.body);
    const blocked = data.optOut || this.isBlacklisted(cfg, data.phone) || !isValidPhone(data.phone);
    const manual = !cfg.enabled || cfg.provider === 'LINK';
    let log: MessageLog;
    try {
      log = await this.prisma.messageLog.create({
        data: {
          clientId: data.clientId ?? null,
          loanId: data.loanId ?? null,
          installmentId: data.installmentId ?? null,
          paymentId: data.paymentId ?? null,
          template: data.template,
          toPhone: normalizePhone(data.phone),
          toName: data.toName ?? null,
          body: data.body,
          channel: manual ? 'LINK' : cfg.provider,
          status: blocked ? 'BLOQUEADO' : manual ? 'LINK_GERADO' : 'PENDENTE',
          lastError: blocked ? (isValidPhone(data.phone) ? 'Opt-out / blacklist' : 'Telefone inválido') : null,
          waLink: link,
          dedupeKey: data.dedupeKey ?? null,
          createdById: data.createdById ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // já gerado hoje
      throw e;
    }
    if (log.status === 'PENDENTE') await this.dispatch(log.id, cfg);
    return log;
  }

  private async dispatch(id: string, cfg: WhatsAppConfig) {
    const delay = msUntilWindow(new Date(), cfg.windowStart, cfg.windowEnd);
    if (this.queue) {
      await this.queue.add('send', { messageId: id }, { jobId: id, delay });
    } else {
      // Sem Redis: tenta já (se dentro da janela); fora da janela fica PENDENTE até a próxima varredura
      if (delay === 0) setImmediate(() => this.sendNow(id).catch((e) => this.logger.error(e.message)));
    }
  }

  /** Worker BullMQ. */
  private async process(job: Job<{ messageId: string }>, token?: string) {
    const cfg = await this.config();
    const delay = msUntilWindow(new Date(), cfg.windowStart, cfg.windowEnd);
    if (delay > 0) {
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? MAX_ATTEMPTS);
    await this.sendNow(job.data.messageId, finalAttempt);
  }

  /** Envia uma mensagem PENDENTE. Em erro retentável relança (BullMQ tenta de novo). */
  async sendNow(id: string, finalAttempt = true) {
    const msg = await this.prisma.messageLog.findUnique({ where: { id } });
    if (!msg || msg.status !== 'PENDENTE') return;
    // Aviso de parcela que já foi paga/cancelada antes do envio: cancela
    if (msg.installmentId && msg.template !== 'PAYMENT_OK') {
      const inst = await this.prisma.installment.findUnique({ where: { id: msg.installmentId }, select: { status: true } });
      if (inst && inst.status !== 'PENDENTE') {
        await this.prisma.messageLog.update({ where: { id }, data: { status: 'CANCELADO', lastError: 'Parcela já paga/cancelada' } });
        return;
      }
    }
    const cfg = await this.config();
    const secrets = {
      apiKey: cfg.apiKeyEnc ? this.crypto.decrypt(cfg.apiKeyEnc) : undefined,
      metaToken: cfg.metaTokenEnc ? this.crypto.decrypt(cfg.metaTokenEnc) : undefined,
    };
    try {
      const providerId = await sendViaProvider(cfg, secrets, msg.toPhone, msg.body);
      await this.prisma.messageLog.update({ where: { id }, data: { status: 'ENVIADO', sentAt: new Date(), providerId, attempts: { increment: 1 }, lastError: null } });
      this.logger.log(`Enviado ${msg.template} para ${msg.toPhone.slice(0, 4)}*****`);
    } catch (e) {
      const err = e as ProviderError;
      const giveUp = finalAttempt || err.retryable === false;
      await this.prisma.messageLog.update({
        where: { id },
        data: { attempts: { increment: 1 }, lastError: err.message.slice(0, 500), ...(giveUp ? { status: 'FALHOU' } : {}) },
      });
      if (!giveUp) throw err;
      this.logger.warn(`Falha definitiva ${msg.template}: ${err.message} - link wa.me disponível`);
    }
  }

  // -------------------------------------------------------------------------
  // Varredura diária 09:00
  // -------------------------------------------------------------------------

  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo', name: 'whatsapp-daily' })
  async dailyCron() {
    try {
      await this.scan();
    } catch (e) {
      this.logger.error(`Varredura WhatsApp falhou: ${(e as Error).stack}`);
    }
  }

  async scan(asOf = today()) {
    const cfg = await this.config();
    const tpl = await this.templates();
    const loans = await this.prisma.loan.findMany({
      where: { status: { in: ['ATIVO', 'PERDA'] } },
      include: { installments: true, client: true },
    });
    let created = 0;
    for (const loan of loans) {
      const cl = loan.client;
      if (!cl.whatsapp || cl.deletedAt) continue;
      const eLoan = toEngineLoan(loan);
      const pix = await this.pixKeyFor(loan.lenderUserId);
      for (const inst of loan.installments.filter((i) => i.status === 'PENDENTE')) {
        const keys = templateForDue(inst.dueDate.toISOString().slice(0, 10), asOf);
        if (!keys.length) continue;
        const v = viewInstallment(toEngineInstallment(inst), eLoan, asOf);
        const vars: TemplateVars = {
          nome: this.firstName(cl.fullName),
          valor: formatBRL(v.originalCents),
          vencimento: isoToBR(v.dueDate),
          valor_atualizado: formatBRL(v.updatedCents),
          dias_atraso: String(v.diasAtraso),
          pix_chave: pix,
          fiador_nome: cl.guarantorName ?? '',
        };
        for (const key of keys) {
          const toGuarantor = key === 'D_PLUS_7_FIADOR';
          if (toGuarantor && (!cfg.notifyGuarantorD7 || !cl.hasGuarantor || !cl.guarantorPhone)) continue;
          const log = await this.enqueue({
            template: key,
            phone: toGuarantor ? cl.guarantorPhone! : cl.whatsapp,
            toName: toGuarantor ? cl.guarantorName : cl.fullName,
            body: renderTemplate(tpl[key], vars),
            clientId: cl.id,
            loanId: loan.id,
            installmentId: inst.id,
            dedupeKey: `${inst.id}:${key}:${asOf}`,
            optOut: cl.whatsappOptOut,
          });
          if (log) created++;
        }
      }
    }
    // Sem fila: reprocessa pendentes antigos (ex.: gerados fora da janela)
    if (!this.queue && msUntilWindow(new Date(), cfg.windowStart, cfg.windowEnd) === 0) {
      const pend = await this.prisma.messageLog.findMany({ where: { status: 'PENDENTE' }, select: { id: true }, take: 200 });
      for (const p of pend) await this.sendNow(p.id);
    }
    this.logger.log(`Varredura ${asOf}: ${created} mensagem(ns) gerada(s)`);
    return { asOf, created };
  }

  /** "Payment OK" após aprovação do pagamento. */
  async paymentOk(paymentId: string) {
    const cfg = await this.config();
    if (!cfg.autoPaymentOk) return null;
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { loan: { include: { client: true } } } });
    if (!p || p.status !== 'APROVADO' || !p.loan.client.whatsapp) return null;
    const tpl = await this.templates();
    const cl = p.loan.client;
    return this.enqueue({
      template: 'PAYMENT_OK',
      phone: cl.whatsapp!,
      toName: cl.fullName,
      body: renderTemplate(tpl.PAYMENT_OK, { nome: this.firstName(cl.fullName), valor: formatBRL(c(p.value)), pix_chave: await this.pixKeyFor(p.loan.lenderUserId) }),
      clientId: cl.id,
      loanId: p.loanId,
      paymentId: p.id,
      dedupeKey: `payment-ok:${p.id}`,
      optOut: cl.whatsappOptOut,
    });
  }

  /** Mensagem firme de cobrança (link wa.me), registrada para auditoria. */
  async collectionMessage(u: AuthUser, clientId: string, target: 'CLIENTE' | 'FIADOR') {
    const cl = await this.prisma.client.findUnique({ where: { id: clientId }, include: { loans: { where: { status: { in: ['ATIVO', 'PERDA'] } }, include: { installments: true } } } });
    if (!cl) throw new NotFoundException('Cliente não encontrado');
    const phone = target === 'FIADOR' ? cl.guarantorPhone : cl.whatsapp;
    if (!phone) throw new BadRequestException(target === 'FIADOR' ? 'Cliente sem fiador com telefone' : 'Cliente sem WhatsApp');
    const asOf = today();
    let debt = 0;
    let maxLate = 0;
    for (const l of cl.loans) {
      const eInst = l.installments.map(toEngineInstallment);
      debt += simulatePayoff(toEngineLoan(l), eInst, asOf)?.amountCents ?? 0;
      for (const i of eInst.filter((x) => x.status === 'PENDENTE')) maxLate = Math.max(maxLate, viewInstallment(i, toEngineLoan(l), asOf).diasAtraso);
    }
    const tpl = await this.templates();
    const key: TemplateKey = target === 'FIADOR' ? 'D_PLUS_7_FIADOR' : 'COBRANCA_FIRME';
    const body = renderTemplate(tpl[key], {
      nome: target === 'FIADOR' ? cl.fullName : this.firstName(cl.fullName),
      valor_atualizado: formatBRL(debt),
      valor: formatBRL(debt),
      dias_atraso: String(maxLate),
      pix_chave: await this.pixKeyFor(cl.loans[0]?.lenderUserId ?? u.id),
      fiador_nome: cl.guarantorName ?? '',
    });
    const log = await this.prisma.messageLog.create({
      data: { clientId, template: key, toPhone: normalizePhone(phone), toName: target === 'FIADOR' ? cl.guarantorName : cl.fullName, body, channel: 'LINK', status: 'LINK_GERADO', waLink: waLink(phone, body), createdById: u.id },
    });
    await this.prisma.collectionAttempt.create({ data: { clientId, userId: u.id, type: target === 'FIADOR' ? 'WHATSAPP_FIADOR' : 'WHATSAPP_FIRME', result: 'Mensagem de cobrança gerada (link wa.me)' } });
    return { id: log.id, text: body, waLink: log.waLink, phone: log.toPhone };
  }

  async test(u: AuthUser, phone: string, text: string) {
    if (!isValidPhone(phone)) throw new BadRequestException('Telefone inválido');
    const log = await this.prisma.messageLog.create({
      data: { template: 'TESTE', toPhone: normalizePhone(phone), body: text, channel: (await this.config()).provider, status: 'PENDENTE', waLink: waLink(phone, text), createdById: u.id },
    });
    await this.sendNow(log.id, true);
    return this.prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } });
  }

  async retry(id: string) {
    const msg = await this.prisma.messageLog.findUnique({ where: { id } });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    if (msg.status !== 'FALHOU') throw new BadRequestException('Só mensagens com falha podem ser reenviadas');
    await this.prisma.messageLog.update({ where: { id }, data: { status: 'PENDENTE', lastError: null } });
    if (this.queue) await this.queue.add('send', { messageId: id }, { jobId: `${id}-retry-${Date.now()}` });
    else await this.sendNow(id);
    return this.prisma.messageLog.findUniqueOrThrow({ where: { id } });
  }

  async status() {
    const counts = await this.prisma.messageLog.groupBy({ by: ['status'], _count: true });
    return {
      queue: this.queue ? 'BULLMQ' : 'MEMORIA',
      jobs: this.queue ? await this.queue.getJobCounts('waiting', 'delayed', 'active', 'failed') : null,
      byStatus: Object.fromEntries(counts.map((x) => [x.status, x._count])),
    };
  }
}
