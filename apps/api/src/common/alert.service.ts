import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';
import { MailService } from './mail.service';
import { SettingsService } from './settings.service';

const REPEAT_MS = 6 * 3600_000; // o mesmo alerta não repete por e-mail antes de 6 h

/**
 * Alertas de falha (backup, envio para a nuvem, rotina das 00:00, WhatsApp).
 * Sempre vira notificação para os Super Admins; por e-mail vai para ALERT_EMAIL (servidor)
 * e para os e-mails cadastrados em Configurações > Backup.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger('Alertas');
  private readonly lastSent = new Map<string, number>();

  constructor(
    private audit: AuditService,
    private mail: MailService,
    private settings: SettingsService,
  ) {}

  async recipients(): Promise<string[]> {
    const env = (process.env.ALERT_EMAIL || process.env.OWNER_EMAIL || '').split(',').map((s) => s.trim().toLowerCase());
    const b = await this.settings.get<{ email?: string; extraEmails?: string[] }>('backup.email', {}).catch(() => ({}) as { email?: string; extraEmails?: string[] });
    return [...new Set([...env, b.email ?? '', ...(b.extraEmails ?? [])].filter(Boolean))];
  }

  /** Registra a falha. Nunca lança erro (quem chama já está tratando outra falha). */
  async failure(title: string, error: unknown, data?: Record<string, unknown>) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${title}: ${detail}`);
    await this.audit.notifyAdmins(title, detail, data).catch(() => undefined);
    const now = Date.now();
    if ((this.lastSent.get(title) ?? 0) + REPEAT_MS > now) return { emailed: false };
    try {
      const to = await this.recipients();
      if (!to.length || !this.mail.configured) return { emailed: false };
      const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      await this.mail.send(to, `LendControl - ALERTA: ${title}`, `${title} em ${when}.\n\nDetalhe: ${detail}\n\nVeja em Configurações > Backup ou no log do servidor. Este alerta não se repete pelas próximas 6 horas.`);
      this.lastSent.set(title, now);
      return { emailed: true };
    } catch (e) {
      this.logger.error(`Não consegui enviar o alerta por e-mail: ${(e as Error).message}`);
      return { emailed: false };
    }
  }
}
