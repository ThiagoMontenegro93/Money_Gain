import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Logger, Post, Put } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import { AlertService } from '../common/alert.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { ZodPipe } from '../common/util';
import { BackupsService, encryptFile } from './backups';
import { S3Config, s3Request } from './s3';

/**
 * Backup fora do servidor (item 4): todo dia 03:00 gera o backup, criptografa com a senha do backup na nuvem (.lcbak)
 * e envia para um armazenamento compatível com S3 (AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO),
 * junto com as fotos, documentos e comprovantes que ainda não foram enviados (também criptografados).
 */
const KEY = 'backup.offsite';
const FILES_PER_RUN = 500;

interface LastRun {
  at: string;
  ok: boolean;
  error?: string | null;
  backupKey?: string | null;
  filesSent?: number;
  filesPending?: number;
}
interface Stored {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  prefix: string;
  secretEnc?: string | null;
  passwordEnc?: string | null;
  last?: LastRun | null;
}
export interface OffsiteView extends Omit<Stored, 'secretEnc' | 'passwordEnc'> {
  hasSecret: boolean;
  hasPassword: boolean;
  filesPending: number;
}

const schema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/[^\s/]+/.test(v), 'Endereço inválido (comece com https://)'),
  region: z.string().trim().max(50).default('auto'),
  bucket: z.string().trim().max(100).refine((v) => v === '' || /^[a-z0-9][a-z0-9.\-_]{1,98}[a-z0-9]$/.test(v), 'Nome do bucket inválido'),
  accessKeyId: z.string().trim().max(200),
  /** Em branco mantém a atual. */
  secretAccessKey: z.string().max(300).optional().or(z.literal('')),
  prefix: z.string().trim().max(100).default('lendcontrol/'),
  /** Senha que criptografa os arquivos enviados. Em branco mantém a atual. */
  password: z.string().min(8, 'A senha do backup na nuvem precisa ter ao menos 8 caracteres').max(200).optional().or(z.literal('')),
});
type Body = z.infer<typeof schema>;

const normPrefix = (p: string) => {
  const s = p.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return s && !s.endsWith('/') ? `${s}/` : s;
};

@Injectable()
export class OffsiteService {
  private readonly logger = new Logger('BackupNuvem');
  private readonly storage = resolve(process.env.STORAGE_DIR || './storage');
  private running = false;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private settings: SettingsService,
    private audit: AuditService,
    private alerts: AlertService,
    private backups: BackupsService,
  ) {}

  private async stored(): Promise<Stored> {
    return this.settings.get<Stored>(KEY, { enabled: false, endpoint: '', region: 'auto', bucket: '', accessKeyId: '', prefix: 'lendcontrol/', secretEnc: null, passwordEnc: null, last: null });
  }

  private async view(s: Stored): Promise<OffsiteView> {
    const { secretEnc, passwordEnc, ...rest } = s;
    const filesPending = await this.prisma.storedFile.count({ where: { offsiteAt: null } });
    return { ...rest, hasSecret: !!secretEnc, hasPassword: !!passwordEnc, filesPending };
  }

  async getSettings() {
    return this.view(await this.stored());
  }

  async saveSettings(u: AuthUser, b: Body) {
    const cur = await this.stored();
    const next: Stored = {
      enabled: b.enabled,
      endpoint: b.endpoint.replace(/\/$/, ''),
      region: b.region || 'auto',
      bucket: b.bucket,
      accessKeyId: b.accessKeyId,
      prefix: normPrefix(b.prefix),
      secretEnc: b.secretAccessKey ? this.crypto.encrypt(b.secretAccessKey) : (cur.secretEnc ?? null),
      passwordEnc: b.password ? this.crypto.encrypt(b.password) : (cur.passwordEnc ?? null),
      last: cur.last ?? null,
    };
    if (next.enabled) this.config(next); // valida que está tudo preenchido
    await this.settings.set(KEY, next);
    const view = await this.view(next);
    await this.audit.log(u.id, 'UPDATE', 'Setting', KEY, { enabled: view.enabled, endpoint: view.endpoint, bucket: view.bucket, prefix: view.prefix, secretChanged: !!b.secretAccessKey, passwordChanged: !!b.password });
    return view;
  }

  private config(s: Stored): { s3: S3Config; password: string; prefix: string } {
    const missing = [!s.endpoint && 'endereço', !s.bucket && 'bucket', !s.accessKeyId && 'chave de acesso', !s.secretEnc && 'chave secreta', !s.passwordEnc && 'senha do backup'].filter(Boolean);
    if (missing.length) throw new BadRequestException({ message: `Backup na nuvem: preencha ${missing.join(', ')}`, code: 'OFFSITE_INCOMPLETE' });
    return {
      s3: { endpoint: s.endpoint, region: s.region || 'auto', bucket: s.bucket, accessKeyId: s.accessKeyId, secretAccessKey: this.crypto.decrypt(s.secretEnc!) },
      password: this.crypto.decrypt(s.passwordEnc!),
      prefix: s.prefix,
    };
  }

  /** Grava um arquivo pequeno no bucket para confirmar endereço, chaves e permissão de escrita. */
  async test(u: AuthUser) {
    const c = this.config(await this.stored());
    const key = `${c.prefix}teste-conexao.txt`;
    try {
      await s3Request(c.s3, 'PUT', key, Buffer.from(`LendControl Pro - teste de conexão em ${new Date().toISOString()}\n`), 'text/plain');
    } catch (e) {
      throw new BadRequestException({ message: `Não consegui gravar no armazenamento: ${(e as Error).message}`, code: 'OFFSITE_FAILED' });
    }
    await this.audit.log(u.id, 'OFFSITE_TEST', 'Setting', KEY, { key });
    return { ok: true, key };
  }

  /** Envia agora (botão) ou pela rotina das 03:00. */
  async run(u: AuthUser | null) {
    if (this.running) throw new BadRequestException({ message: 'O envio para a nuvem já está em andamento', code: 'OFFSITE_RUNNING' });
    const s = await this.stored();
    const c = this.config(s);
    this.running = true;
    const last: LastRun = { at: new Date().toISOString(), ok: false, filesSent: 0 };
    try {
      const b = await this.backups.create(u, { automatic: !u, label: 'nuvem' });
      const f = await this.backups.file(b.id);
      last.backupKey = `${c.prefix}backups/${b.fileName.replace(/\.xlsx$/, '.lcbak')}`;
      await s3Request(c.s3, 'PUT', last.backupKey, encryptFile(f.buf, c.password));

      const files = await this.prisma.storedFile.findMany({ where: { offsiteAt: null }, orderBy: { createdAt: 'asc' }, take: FILES_PER_RUN });
      for (const sf of files) {
        const path = join(this.storage, sf.storageKey);
        if (!existsSync(path)) {
          this.logger.warn(`Arquivo ${sf.storageKey} não existe no disco; marcado para não tentar de novo`);
          await this.prisma.storedFile.update({ where: { id: sf.id }, data: { offsiteAt: new Date(0) } });
          continue;
        }
        await s3Request(c.s3, 'PUT', `${c.prefix}arquivos/${sf.storageKey}.lcbak`, encryptFile(readFileSync(path), c.password));
        await this.prisma.storedFile.update({ where: { id: sf.id }, data: { offsiteAt: new Date() } });
        last.filesSent!++;
      }
      last.filesPending = await this.prisma.storedFile.count({ where: { offsiteAt: null } });
      last.ok = true;
      await this.audit.log(u?.id ?? null, 'OFFSITE_BACKUP', 'BackupLog', b.id, { key: last.backupKey, filesSent: last.filesSent });
      this.logger.log(`Backup enviado para a nuvem: ${last.backupKey} + ${last.filesSent} arquivo(s)`);
    } catch (e) {
      last.error = (e as Error).message;
      last.filesPending = await this.prisma.storedFile.count({ where: { offsiteAt: null } }).catch(() => undefined);
    } finally {
      this.running = false;
      await this.settings.set(KEY, { ...(await this.stored()), last });
    }
    if (!last.ok) {
      await this.alerts.failure('Envio do backup para a nuvem falhou', last.error, { backupKey: last.backupKey });
      if (u) throw new BadRequestException({ message: `Envio para a nuvem falhou: ${last.error}`, code: 'OFFSITE_FAILED' });
    }
    return this.view({ ...(await this.stored()) });
  }

  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo', name: 'offsite-backup' })
  async daily() {
    const s = await this.stored().catch(() => null);
    if (!s?.enabled) return;
    try {
      await this.run(null);
    } catch (e) {
      await this.alerts.failure('Envio do backup para a nuvem falhou', e);
    }
  }
}

@Controller('backups/offsite')
@Roles('SUPER_ADMIN')
export class OffsiteController {
  constructor(private offsite: OffsiteService) {}

  @Get()
  get() {
    return this.offsite.getSettings();
  }

  @Put()
  save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(schema)) b: Body) {
    return this.offsite.saveSettings(u, b);
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser) {
    return this.offsite.test(u);
  }

  @Post('run')
  @HttpCode(200)
  run(@CurrentUser() u: AuthUser) {
    return this.offsite.run(u);
  }
}
