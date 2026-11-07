import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/** Envio de e-mail via SMTP (SMTP_URL, ex.: smtps://usuario:senha@smtp.gmail.com:465). */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  get configured() {
    return !!process.env.SMTP_URL;
  }

  async send(to: string[], subject: string, text: string, attachments: MailAttachment[] = []) {
    if (!this.configured)
      throw new BadRequestException({ message: 'Servidor de e-mail não configurado (defina SMTP_URL no servidor)', code: 'SMTP_NOT_CONFIGURED' });
    const transport = nodemailer.createTransport(process.env.SMTP_URL!);
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || 'LendControl <backup@lendcontrol.app>',
      to: to.join(', '),
      subject,
      text,
      attachments,
    });
    this.logger.log(`E-mail enviado para ${to.join(', ')} (${info.messageId})`);
    return info.messageId as string;
  }
}
