import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { TemplateKey } from '@lendcontrol/core';
import { MessageStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/util';
import { ClientsService } from '../clients/clients.service';
import { MessagingService } from './messaging.service';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const configSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['EVOLUTION', 'META', 'LINK']),
    baseUrl: z.string().url().or(z.literal('')),
    instance: z.string().max(100),
    apiKey: z.string().max(500).nullable(),
    metaPhoneNumberId: z.string().max(50),
    metaToken: z.string().max(1000).nullable(),
    windowStart: hhmm,
    windowEnd: hhmm,
    sendTime: hhmm,
    autoPaymentOk: z.boolean(),
    notifyGuarantorD7: z.boolean(),
    blacklist: z.array(z.string().max(30)).max(1000),
  })
  .partial();

@Controller()
export class MessagingController {
  constructor(
    private msg: MessagingService,
    private prisma: PrismaService,
    private clients: ClientsService,
  ) {}

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('messaging/config')
  config() {
    return this.msg.publicConfig();
  }

  @Roles('SUPER_ADMIN')
  @Put('messaging/config')
  saveConfig(@CurrentUser() u: AuthUser, @Body(new ZodPipe(configSchema)) b: z.infer<typeof configSchema>) {
    return this.msg.saveConfig(u, b);
  }

  @Get('messaging/templates')
  templates() {
    return this.msg.listTemplates();
  }

  @Roles('SUPER_ADMIN')
  @Put('messaging/templates/:key')
  saveTemplate(@CurrentUser() u: AuthUser, @Param('key') key: TemplateKey, @Body(new ZodPipe(z.object({ text: z.string().max(1000).nullable() }))) b: { text: string | null }) {
    return this.msg.saveTemplate(u, key, b.text);
  }

  @Get('messaging/logs')
  async logs(@CurrentUser() u: AuthUser, @Query('clientId') clientId?: string, @Query('status') status?: MessageStatus, @Query('limit') limit?: string) {
    if (clientId) await this.clients.assertAccess(u, clientId);
    const rows = await this.prisma.messageLog.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
        ...(isAdmin(u) ? {} : { client: this.clients.scope(u) }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      include: { client: { select: { id: true, fullName: true } } },
    });
    return rows.map((m) => ({
      id: m.id, template: m.template, toPhone: m.toPhone, toName: m.toName, body: m.body, channel: m.channel, status: m.status,
      attempts: m.attempts, lastError: m.lastError, waLink: m.waLink, scheduledFor: m.scheduledFor.toISOString(),
      sentAt: m.sentAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(), client: m.client,
    }));
  }

  @Get('messaging/status')
  status() {
    return this.msg.status();
  }

  @Roles('SUPER_ADMIN')
  @Post('messaging/scan')
  scan() {
    return this.msg.scan();
  }

  @Roles('SUPER_ADMIN')
  @Post('messaging/test')
  test(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ phone: z.string(), text: z.string().min(1).max(1000) }))) b: { phone: string; text: string }) {
    return this.msg.test(u, b.phone, b.text);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('messaging/:id/retry')
  retry(@Param('id') id: string) {
    return this.msg.retry(id);
  }

  @Post('clients/:id/collection-message')
  async collection(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ target: z.enum(['CLIENTE', 'FIADOR']).default('CLIENTE') }))) b: { target: 'CLIENTE' | 'FIADOR' }) {
    await this.clients.assertAccess(u, id);
    return this.msg.collectionMessage(u, id, b.target);
  }
}
