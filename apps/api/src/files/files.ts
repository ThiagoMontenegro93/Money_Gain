import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'crypto';
import { Response } from 'express';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Public } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX = 10 * 1024 * 1024;
const TTL_SECONDS = 300; // URL assinada de 5 minutos

/** Armazenamento privado em disco (Fase 2: S3/R2 com URL pré-assinada). */
@Injectable()
export class FilesService {
  private dir = resolve(process.env.STORAGE_DIR || './storage');
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private audit: AuditService,
  ) {
    mkdirSync(this.dir, { recursive: true });
  }

  async save(u: AuthUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Envie um arquivo no campo "file"');
    if (!ALLOWED.includes(file.mimetype)) throw new BadRequestException('Formato não permitido (use JPG, PNG, WEBP, HEIC ou PDF)');
    if (file.size > MAX) throw new BadRequestException('Arquivo maior que 10 MB');
    // Verificação simples de assinatura (magic bytes)
    const h = file.buffer.subarray(0, 4).toString('hex');
    const okMagic = h.startsWith('ffd8') || h === '89504e47' || h === '25504446' || file.buffer.subarray(8, 12).toString() === 'WEBP' || file.mimetype === 'image/heic';
    if (!okMagic) throw new BadRequestException('Conteúdo do arquivo não corresponde ao tipo informado');
    const key = randomUUID();
    writeFileSync(join(this.dir, key), file.buffer, { mode: 0o600 });
    const f = await this.prisma.storedFile.create({
      data: {
        storageKey: key,
        originalName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById: u.id,
      },
    });
    return { id: f.id, originalName: f.originalName, mimeType: f.mimeType, size: f.size };
  }

  /** Operador só acessa arquivos que enviou ou ligados a clientes/empréstimos dele. */
  async canAccess(u: AuthUser, fileId: string, uploadedById: string) {
    if (isAdmin(u) || uploadedById === u.id) return true;
    const clientScope = { deletedAt: null, OR: [{ responsibleUserId: u.id }, { loans: { some: { lenderUserId: u.id } } }] };
    const [cl, pay, doc, rec] = await Promise.all([
      this.prisma.client.count({ where: { ...clientScope, AND: [{ OR: [{ selfieFileId: fileId }, { guarantorDocFileId: fileId }] }] } }),
      this.prisma.payment.count({ where: { comprovanteFileId: fileId, loan: { lenderUserId: u.id } } }),
      this.prisma.document.count({ where: { fileId, client: clientScope } }),
      this.prisma.clientReceipt.count({ where: { fileId, client: clientScope } }),
    ]);
    return cl + pay + doc + rec > 0;
  }

  async signedUrl(u: AuthUser, id: string, baseUrl: string) {
    const f = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!f || !(await this.canAccess(u, id, f.uploadedById))) throw new NotFoundException('Arquivo não encontrado');
    const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const sig = this.crypto.sign(`${id}.${exp}`);
    await this.audit.log(u.id, 'VIEW_FILE', 'StoredFile', id); // log de visualização (LGPD)
    return { url: `${baseUrl}/api/files/raw/${id}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async raw(id: string, exp: string, sig: string) {
    const e = Number(exp);
    if (!e || e < Date.now() / 1000) throw new ForbiddenException('Link expirado');
    if (!sig || !/^[0-9a-f]{64}$/.test(sig) || !this.crypto.verify(`${id}.${e}`, sig)) throw new ForbiddenException('Assinatura inválida');
    const f = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    const path = join(this.dir, f.storageKey);
    if (!existsSync(path)) throw new NotFoundException('Arquivo ausente no armazenamento');
    return { path, mimeType: f.mimeType, name: f.originalName };
  }
}

@Controller('files')
export class FilesController {
  constructor(private files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.files.save(u, file);
  }

  @Get(':id/url')
  url(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const base = process.env.PUBLIC_API_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    return this.files.signedUrl(u, id, base);
  }

  @Public()
  @Get('raw/:id')
  async raw(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const f = await this.files.raw(id, exp, sig);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(f.path);
  }
}
