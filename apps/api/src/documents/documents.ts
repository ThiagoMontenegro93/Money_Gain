import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UnprocessableEntityException,
  UseInterceptors,
} from '@nestjs/common';
import { formatBRL, formatCPF, isoToBR, isValidISODate, RELATIONS, simulatePayoff, viewInstallment } from '@lendcontrol/core';
import { DocumentType } from '@prisma/client';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { AuthUser, CurrentUser, isAdmin, Public, Roles } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { c, d, dt, iso, today, ZodPipe } from '../common/util';
import { ClientsService } from '../clients/clients.service';
import { FilesService } from '../files/files';
import { toEngineInstallment, toEngineLoan } from '../loans/loan-mapper';

const TTL = 300;
const DOC_LABEL: Record<DocumentType, string> = {
  RG: 'RG', CPF: 'CPF', COMPROVANTE_RESIDENCIA: 'Comprovante de residência', COMPROVANTE_RENDA: 'Comprovante de renda',
  SELFIE: 'Selfie', CONTRATO: 'Contrato assinado', FIADOR_FOTO: 'Documento do fiador', COMPROVANTE_PAGAMENTO_CLIENTE: 'Comprovante de pagamento',
};

@Injectable()
export class DocumentsService {
  private dir = resolve(process.env.STORAGE_DIR || './storage');
  constructor(
    private prisma: PrismaService,
    private clients: ClientsService,
    private files: FilesService,
    private crypto: CryptoService,
    private audit: AuditService,
  ) {}

  private status(doc: { isVerified: boolean; expiryDate: Date | null }) {
    if (doc.expiryDate && iso(doc.expiryDate)! < today()) return 'VENCIDO';
    return doc.isVerified ? 'VERIFICADO' : 'PENDENTE';
  }

  async list(u: AuthUser, clientId: string) {
    await this.clients.assertAccess(u, clientId);
    const docs = await this.prisma.document.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { viewLogs: true } } } });
    const fileIds = docs.map((x) => x.fileId);
    const files = await this.prisma.storedFile.findMany({ where: { id: { in: fileIds } } });
    return docs.map((x) => {
      const f = files.find((ff) => ff.id === x.fileId);
      return {
        id: x.id, type: x.type, label: DOC_LABEL[x.type], fileId: x.fileId, mimeType: f?.mimeType ?? null, originalName: f?.originalName ?? null,
        isVerified: x.isVerified, verifiedAt: x.verifiedAt?.toISOString() ?? null, expiryDate: iso(x.expiryDate), status: this.status(x),
        notes: x.notes, views: x._count.viewLogs, createdAt: x.createdAt.toISOString(),
      };
    });
  }

  async create(u: AuthUser, clientId: string, b: { type: DocumentType; fileId: string; expiryDate?: string | null; notes?: string | null }) {
    await this.clients.assertAccess(u, clientId);
    const f = await this.prisma.storedFile.findUnique({ where: { id: b.fileId } });
    if (!f || (!isAdmin(u) && f.uploadedById !== u.id)) throw new BadRequestException('Arquivo não encontrado (faça o upload novamente)');
    const doc = await this.prisma.document.create({
      data: { clientId, type: b.type, fileId: b.fileId, fileUrl: `private://${f.storageKey}`, expiryDate: b.expiryDate ? dt(b.expiryDate) : null, notes: b.notes ?? null },
    });
    // Mantém os atalhos da ficha sincronizados
    if (b.type === 'SELFIE') await this.prisma.client.update({ where: { id: clientId }, data: { selfieFileId: b.fileId } });
    if (b.type === 'FIADOR_FOTO') await this.prisma.client.update({ where: { id: clientId }, data: { guarantorDocFileId: b.fileId } });
    await this.audit.log(u.id, 'CREATE', 'Document', doc.id, { type: b.type });
    return (await this.list(u, clientId)).find((x) => x.id === doc.id);
  }

  private async findDoc(u: AuthUser, id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    await this.clients.assertAccess(u, doc.clientId);
    return doc;
  }

  async update(u: AuthUser, id: string, b: { isVerified?: boolean; expiryDate?: string | null; notes?: string | null }) {
    const doc = await this.findDoc(u, id);
    if (b.isVerified !== undefined && !isAdmin(u)) throw new ForbiddenException('Só administradores verificam documentos');
    await this.prisma.document.update({
      where: { id },
      data: {
        ...(b.isVerified !== undefined ? { isVerified: b.isVerified, verifiedById: b.isVerified ? u.id : null, verifiedAt: b.isVerified ? new Date() : null } : {}),
        ...(b.expiryDate !== undefined ? { expiryDate: b.expiryDate ? dt(b.expiryDate) : null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      },
    });
    await this.audit.log(u.id, 'UPDATE', 'Document', id, b);
    return (await this.list(u, doc.clientId)).find((x) => x.id === id);
  }

  async remove(u: AuthUser, id: string) {
    const doc = await this.findDoc(u, id);
    if (!isAdmin(u)) throw new ForbiddenException('Só administradores removem documentos');
    await this.prisma.document.delete({ where: { id } });
    await this.audit.log(u.id, 'DELETE', 'Document', id, { type: doc.type, clientId: doc.clientId });
    return { ok: true };
  }

  /** URL assinada de 5 minutos, com marca d'água do visualizador e log LGPD. */
  async signedUrl(u: AuthUser, id: string, ip: string) {
    const doc = await this.findDoc(u, id);
    await this.prisma.documentViewLog.create({ data: { documentId: id, userId: u.id, ip } });
    const exp = Math.floor(Date.now() / 1000) + TTL;
    const sig = this.crypto.sign(`doc.${id}.${u.id}.${exp}`);
    const base = process.env.PUBLIC_API_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    void doc;
    return { url: `${base}/api/documents/raw/${id}?v=${u.id}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async raw(id: string, viewer: string, exp: string, sig: string) {
    const e = Number(exp);
    if (!e || e < Date.now() / 1000) throw new ForbiddenException('Link expirado');
    if (!/^[0-9a-f]{64}$/.test(sig ?? '') || !this.crypto.verify(`doc.${id}.${viewer}.${e}`, sig)) throw new ForbiddenException('Assinatura inválida');
    const doc = await this.prisma.document.findUnique({ where: { id }, include: { client: { select: { fullName: true } } } });
    if (!doc) throw new NotFoundException();
    const f = await this.prisma.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
    const path = join(this.dir, f.storageKey);
    if (!existsSync(path)) throw new NotFoundException('Arquivo ausente');
    const user = await this.prisma.user.findUnique({ where: { id: viewer }, select: { name: true } });
    if (!f.mimeType.startsWith('image/') || f.mimeType === 'image/heic') return { buffer: readFileSync(path), mimeType: f.mimeType, name: f.originalName };
    // Marca d'água + selo de verificação
    const img = sharp(readFileSync(path)).rotate();
    const meta = await img.metadata().catch(() => {
      throw new UnprocessableEntityException('Imagem corrompida ou em formato não suportado');
    });
    const w = meta.width ?? 800;
    const h = meta.height ?? 600;
    const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const text = esc(`LENDCONTROL - USO RESTRITO - ${user?.name ?? 'usuário'} - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    const fs = Math.max(14, Math.round(Math.min(w, h) / 22));
    const rows = Array.from({ length: 7 }, (_, i) => `<text x="${-w / 2}" y="${(i * h) / 3.5 - h / 2}" font-size="${fs}" font-family="Arial, sans-serif" fill="rgba(220,38,38,0.28)" font-weight="700">${text}   ${text}</text>`).join('');
    const stamp = doc.isVerified
      ? `<g transform="translate(${w - fs * 9},${fs * 1.5})"><rect width="${fs * 8.5}" height="${fs * 2}" rx="${fs / 3}" fill="rgba(16,185,129,0.85)"/><text x="${fs * 0.5}" y="${fs * 1.35}" font-size="${fs}" font-family="Arial" fill="#fff" font-weight="700">VERIFICADO</text></g>`
      : '';
    const svg = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-30 ${w / 2} ${h / 2})">${rows}</g>${stamp}</svg>`);
    const buffer = await img
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer()
      .catch(() => {
        throw new UnprocessableEntityException('Imagem corrompida ou em formato não suportado');
      });
    return { buffer, mimeType: 'image/jpeg', name: f.originalName.replace(/\.\w+$/, '') + '.jpg' };
  }

  // ---------------------------------------------------------------------------
  // Comprovantes enviados pelo cliente (galeria 2)
  // ---------------------------------------------------------------------------

  async listReceipts(u: AuthUser, clientId: string) {
    await this.clients.assertAccess(u, clientId);
    const rows = await this.prisma.clientReceipt.findMany({ where: { clientId }, orderBy: { sentAt: 'desc' }, include: { payment: { include: { loan: { select: { code: true } } } } } });
    const files = await this.prisma.storedFile.findMany({ where: { id: { in: rows.map((r) => r.fileId) } } });
    return rows.map((r) => ({
      id: r.id, fileId: r.fileId, mimeType: files.find((f) => f.id === r.fileId)?.mimeType ?? null, sentAt: r.sentAt.toISOString(),
      informedValueCents: r.informedValue === null ? null : c(r.informedValue), status: r.status, notes: r.notes,
      checkedAt: r.checkedAt?.toISOString() ?? null,
      payment: r.payment ? { id: r.payment.id, loanCode: r.payment.loan.code, type: r.payment.type, status: r.payment.status, valueCents: c(r.payment.value) } : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createReceipt(u: AuthUser, clientId: string, b: { fileId: string; sentAt: string; informedValueCents?: number | null; notes?: string | null }) {
    await this.clients.assertAccess(u, clientId);
    const f = await this.prisma.storedFile.findUnique({ where: { id: b.fileId } });
    if (!f || (!isAdmin(u) && f.uploadedById !== u.id)) throw new BadRequestException('Arquivo não encontrado (faça o upload novamente)');
    // Vincula automaticamente ao pagamento pendente do cliente, se houver exatamente um
    const pending = await this.prisma.payment.findMany({ where: { status: 'AGUARDANDO_APROVACAO', loan: { clientId } } });
    const link = pending.length === 1 ? pending[0] : null;
    const r = await this.prisma.clientReceipt.create({
      data: { clientId, fileId: b.fileId, sentAt: new Date(b.sentAt), informedValue: b.informedValueCents == null ? null : d(b.informedValueCents), notes: b.notes ?? null, createdById: u.id, paymentId: link?.id ?? null },
    });
    if (link && !link.comprovanteFileId) await this.prisma.payment.update({ where: { id: link.id }, data: { comprovanteFileId: b.fileId } });
    await this.audit.log(u.id, 'CREATE', 'ClientReceipt', r.id, { linkedPayment: link?.id ?? null });
    return { ...(await this.listReceipts(u, clientId)).find((x) => x.id === r.id)!, autoLinked: !!link };
  }

  async checkReceipt(u: AuthUser, id: string, paymentId?: string | null) {
    const r = await this.prisma.clientReceipt.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Comprovante não encontrado');
    await this.clients.assertAccess(u, r.clientId);
    if (paymentId) {
      const p = await this.prisma.payment.findFirst({ where: { id: paymentId, loan: { clientId: r.clientId } } });
      if (!p) throw new BadRequestException('Pagamento não pertence a este cliente');
      if (!p.comprovanteFileId) await this.prisma.payment.update({ where: { id: p.id }, data: { comprovanteFileId: r.fileId } });
    }
    await this.prisma.clientReceipt.update({ where: { id }, data: { status: 'CONFERIDO', checkedById: u.id, checkedAt: new Date(), ...(paymentId ? { paymentId } : {}) } });
    await this.audit.log(u.id, 'CHECK', 'ClientReceipt', id, { paymentId });
    return (await this.listReceipts(u, r.clientId)).find((x) => x.id === id);
  }

  async fileUrl(u: AuthUser, fileId: string) {
    const base = process.env.PUBLIC_API_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    return this.files.signedUrl(u, fileId, base);
  }

  // ---------------------------------------------------------------------------
  // Cobrança: carta extrajudicial e dossiê (PDF)
  // ---------------------------------------------------------------------------

  private async collectData(clientId: string) {
    const cl = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      include: {
        loans: { include: { installments: true, payments: { where: { status: 'APROVADO' }, orderBy: { paidAt: 'asc' } }, lender: { select: { name: true } } }, orderBy: { releaseDate: 'asc' } },
        collectionAttempts: { orderBy: { date: 'asc' }, include: { user: { select: { name: true } } } },
        documents: true,
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    const owner = await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } });
    const asOf = today();
    const loans = cl.loans.map((l) => {
      const eLoan = toEngineLoan(l);
      const eInst = l.installments.map(toEngineInstallment);
      const views = eInst.map((i) => viewInstallment(i, eLoan, asOf)).sort((a, b) => a.number - b.number);
      const payoff = l.status === 'ATIVO' || l.status === 'PERDA' ? (simulatePayoff(eLoan, eInst, asOf)?.amountCents ?? 0) : 0;
      return { l, views, payoff, overdue: views.filter((v) => v.displayStatus === 'ATRASADA') };
    });
    return { cl, owner, asOf, loans, total: loans.reduce((s, x) => s + x.payoff, 0) };
  }

  private pdfHeader(doc: PDFKit.PDFDocument, title: string) {
    doc.fontSize(9).fillColor('#64748B').text('LendControl Pro', { align: 'right' });
    doc.moveDown(0.5).fontSize(16).fillColor('#0F172A').font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.8).font('Helvetica').fontSize(11);
  }

  private toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      doc.on('data', (ch: Buffer) => chunks.push(ch));
      doc.on('end', () => res(Buffer.concat(chunks)));
      doc.on('error', rej);
      doc.end();
    });
  }

  async letter(u: AuthUser, clientId: string) {
    await this.clients.assertAccess(u, clientId);
    const { cl, owner, asOf, loans, total } = await this.collectData(clientId);
    const active = loans.filter((x) => x.payoff > 0);
    if (!active.length) throw new BadRequestException('Cliente sem dívida em aberto');
    const cpf = cl.cpfEncrypted ? formatCPF(this.crypto.decrypt(cl.cpfEncrypted)) : 'não informado';
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Notificação extrajudicial - ${cl.fullName}` } });
    this.pdfHeader(doc, 'NOTIFICAÇÃO EXTRAJUDICIAL DE COBRANÇA');
    doc.text(`${cl.city ?? ''}${cl.city ? ', ' : ''}${isoToBR(asOf)}`, { align: 'right' }).moveDown();
    doc.font('Helvetica-Bold').text('Notificado(a): ', { continued: true }).font('Helvetica').text(cl.fullName);
    doc.text(`CPF: ${cpf}`);
    doc.text(`Endereço: ${[cl.street, cl.number, cl.complement].filter(Boolean).join(', ')}${cl.district ? ` - ${cl.district}` : ''}${cl.city ? ` - ${cl.city}/${cl.state ?? ''}` : ''}${cl.cep ? ` - CEP ${cl.cep}` : ''}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Notificante: ', { continued: true }).font('Helvetica').text(owner?.name ?? 'Credor');
    doc.moveDown();
    doc.text(
      `Prezado(a) ${cl.fullName}, pela presente notificamos que constam em aberto os valores abaixo, referentes a empréstimo(s) concedido(s) a V.Sa., atualizados até ${isoToBR(asOf)} conforme as condições pactuadas (juros e multa diária por atraso):`,
      { align: 'justify' },
    );
    doc.moveDown();
    for (const x of active) {
      doc.font('Helvetica-Bold').text(`Contrato #${x.l.code} - liberado em ${isoToBR(iso(x.l.releaseDate)!)} - principal ${formatBRL(c(x.l.principal))}`);
      doc.font('Helvetica');
      for (const v of x.overdue) doc.text(`   • Parcela ${v.number}, vencida em ${isoToBR(v.dueDate)} (${v.diasAtraso} dias): ${formatBRL(v.updatedCents)}`);
      doc.text(`   Valor para quitação nesta data: ${formatBRL(x.payoff)}`).moveDown(0.5);
    }
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(`TOTAL ATUALIZADO: ${formatBRL(total)}`).fontSize(11).font('Helvetica').moveDown();
    doc.text(
      'Solicitamos a regularização do débito no prazo de 5 (cinco) dias úteis a contar do recebimento desta notificação, ou o contato para negociação. ' +
        'Decorrido o prazo sem manifestação, poderão ser adotadas as medidas de cobrança cabíveis, inclusive a inclusão em cadastros de inadimplentes e o ajuizamento de ação de cobrança.',
      { align: 'justify' },
    );
    if (cl.hasGuarantor && cl.guarantorName) {
      doc.moveDown().text(`Esta notificação será comunicada também ao(à) fiador(a) ${cl.guarantorName}${cl.guarantorPhone ? ` (${cl.guarantorPhone})` : ''}.`, { align: 'justify' });
    }
    if (owner?.pixKey) doc.moveDown().text(`Pagamento via PIX: ${owner.pixKey}`);
    doc.moveDown(3).text('_________________________________________', { align: 'center' }).text(owner?.name ?? 'Credor', { align: 'center' });
    await this.prisma.collectionAttempt.create({ data: { clientId, userId: u.id, type: 'CARTA', result: `Carta extrajudicial gerada - ${formatBRL(total)}` } });
    await this.audit.log(u.id, 'GENERATE_LETTER', 'Client', clientId, { totalCents: total });
    return this.toBuffer(doc);
  }

  async dossier(u: AuthUser, clientId: string) {
    if (!isAdmin(u)) throw new ForbiddenException('Dossiê disponível apenas para administradores');
    await this.clients.assertAccess(u, clientId);
    const { cl, asOf, loans, total } = await this.collectData(clientId);
    const cpf = cl.cpfEncrypted ? formatCPF(this.crypto.decrypt(cl.cpfEncrypted)) : '—';
    const gcpf = cl.guarantorCpfEncrypted ? formatCPF(this.crypto.decrypt(cl.guarantorCpfEncrypted)) : '—';
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Dossiê - ${cl.fullName}` } });
    this.pdfHeader(doc, 'DOSSIÊ DE COBRANÇA');
    const sec = (t: string) => doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor('#1E3A8A').text(t.toUpperCase()).fillColor('#0F172A').font('Helvetica').fontSize(10).moveDown(0.3);
    const kv = (k: string, v: string | null | undefined) => doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v || '—');
    doc.fontSize(10).text(`Gerado em ${isoToBR(asOf)} por ${u.name}. Documento confidencial (LGPD).`);
    sec('Identificação');
    kv('Nome', cl.fullName); kv('CPF', cpf); kv('RG', [cl.rg, cl.rgIssuer].filter(Boolean).join(' ')); kv('Nascimento', cl.birthDate ? isoToBR(iso(cl.birthDate)!) : null);
    kv('WhatsApp', [cl.whatsapp, cl.whatsapp2].filter(Boolean).join(' / ')); kv('Endereço', `${[cl.street, cl.number, cl.complement].filter(Boolean).join(', ')} - ${cl.district ?? ''} - ${cl.city ?? ''}/${cl.state ?? ''} - CEP ${cl.cep ?? ''}`);
    kv('Ponto de referência', cl.reference); kv('Profissão / trabalho', [cl.profession, cl.workplace].filter(Boolean).join(' - ')); kv('Chave PIX', cl.pixKey);
    sec('Vínculos');
    kv('Emergência', `${cl.emergencyName ?? ''} (${RELATIONS.find((r) => r.value === cl.emergencyRelation)?.label ?? ''}) ${cl.emergencyPhone1 ?? ''} ${cl.emergencyPhone2 ?? ''}`);
    kv('Fiador', cl.hasGuarantor ? `${cl.guarantorName ?? ''} - CPF ${gcpf} - ${cl.guarantorPhone ?? ''}` : 'Sem fiador');
    kv('Indicação', [cl.referrerName, cl.referrerPhone].filter(Boolean).join(' - '));
    sec('Situação');
    kv('Score', `${cl.score}/10 - ${cl.classificacao}`); kv('Dias sem pagar', String(cl.diasSemPagar)); kv('Total atualizado em aberto', formatBRL(total));
    kv('Negativado', cl.negativadoEm ? cl.negativadoEm.toLocaleDateString('pt-BR') : 'Não');
    sec('Empréstimos e parcelas');
    for (const x of loans) {
      doc.font('Helvetica-Bold').text(`#${x.l.code} - ${x.l.status} - liberado ${isoToBR(iso(x.l.releaseDate)!)} - principal ${formatBRL(c(x.l.principal))} - ${Number(x.l.interestRate)}% - funcionário ${x.l.lender.name}`).font('Helvetica');
      for (const v of x.views.filter((v) => v.displayStatus !== 'PROJECAO' && v.displayStatus !== 'CANCELADA'))
        doc.text(`   Parcela ${v.number} - venc. ${isoToBR(v.dueDate)} - ${v.displayStatus}${v.diasAtraso ? ` (${v.diasAtraso}d, ${formatBRL(v.updatedCents)})` : ` - ${formatBRL(v.originalCents)}`}${v.paidAt ? ` - pago ${isoToBR(v.paidAt)}` : ''}`);
      for (const p of x.l.payments) doc.text(`   Pagamento ${p.type} ${formatBRL(c(p.value))} em ${isoToBR(iso(p.paidAt)!)}`);
    }
    sec('Tentativas de cobrança');
    if (!cl.collectionAttempts.length) doc.text('Nenhuma registrada.');
    for (const a of cl.collectionAttempts) doc.text(`${a.date.toLocaleDateString('pt-BR')} - ${a.type} - ${a.result} (${a.user.name})`);
    sec('Documentos arquivados');
    if (!cl.documents.length) doc.text('Nenhum documento anexado.');
    for (const dd of cl.documents) doc.text(`${DOC_LABEL[dd.type]} - ${dd.isVerified ? 'verificado' : 'pendente'}${dd.expiryDate ? ` - validade ${isoToBR(iso(dd.expiryDate)!)}` : ''} - enviado ${dd.createdAt.toLocaleDateString('pt-BR')}`);
    sec('Histórico');
    for (const h of cl.history) doc.text(`${h.createdAt.toLocaleDateString('pt-BR')} - ${h.message}`);
    await this.audit.log(u.id, 'GENERATE_DOSSIER', 'Client', clientId);
    await this.prisma.collectionAttempt.create({ data: { clientId, userId: u.id, type: 'JURIDICO', result: 'Dossiê completo gerado para encaminhamento jurídico' } });
    return this.toBuffer(doc);
  }

  async negativate(u: AuthUser, clientId: string, mark: boolean) {
    if (!isAdmin(u)) throw new ForbiddenException('Só administradores marcam negativação');
    await this.clients.assertAccess(u, clientId);
    await this.prisma.client.update({ where: { id: clientId }, data: { negativadoEm: mark ? new Date() : null, negativadoPorId: mark ? u.id : null } });
    await this.prisma.clientHistory.create({ data: { clientId, userId: u.id, type: 'NEGATIVACAO', message: mark ? `Marcado para negativação por ${u.name}` : `Negativação removida por ${u.name}` } });
    if (mark) await this.prisma.collectionAttempt.create({ data: { clientId, userId: u.id, type: 'NEGATIVACAO', result: 'Cliente marcado para negativação' } });
    return { negativadoEm: mark ? new Date().toISOString() : null };
  }

  async optOut(u: AuthUser, clientId: string, optOut: boolean) {
    await this.clients.assertAccess(u, clientId);
    await this.prisma.client.update({ where: { id: clientId }, data: { whatsappOptOut: optOut } });
    await this.audit.log(u.id, 'WHATSAPP_OPT_OUT', 'Client', clientId, { optOut });
    return { whatsappOptOut: optOut };
  }
}

const docSchema = z.object({ type: z.nativeEnum(DocumentType), fileId: z.string(), expiryDate: z.string().refine(isValidISODate).nullable().optional(), notes: z.string().max(500).nullable().optional() });
const docUpdate = z.object({ isVerified: z.boolean().optional(), expiryDate: z.string().refine(isValidISODate).nullable().optional(), notes: z.string().max(500).nullable().optional() });
const receiptSchema = z.object({ fileId: z.string(), sentAt: z.string().datetime({ offset: true }).or(z.string().refine(isValidISODate)), informedValueCents: z.number().int().min(0).nullable().optional(), notes: z.string().max(500).nullable().optional() });

@Controller()
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Get('clients/:id/documents')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.docs.list(u, id);
  }

  @Post('clients/:id/documents')
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(docSchema)) b: z.infer<typeof docSchema>) {
    return this.docs.create(u, id, b);
  }

  @Patch('documents/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(docUpdate)) b: z.infer<typeof docUpdate>) {
    return this.docs.update(u, id, b);
  }

  @Delete('documents/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.docs.remove(u, id);
  }

  @Get('documents/:id/url')
  url(@CurrentUser() u: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.docs.signedUrl(u, id, ip);
  }

  @Public()
  @Get('documents/raw/:id')
  async raw(@Param('id') id: string, @Query('v') v: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const f = await this.docs.raw(id, v, exp, sig);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
    res.end(f.buffer);
  }

  @Get('clients/:id/receipts')
  receipts(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.docs.listReceipts(u, id);
  }

  @Post('clients/:id/receipts')
  @UseInterceptors(IdempotencyInterceptor)
  createReceipt(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(receiptSchema)) b: z.infer<typeof receiptSchema>) {
    return this.docs.createReceipt(u, id, b);
  }

  @Post('receipts/:id/check')
  check(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ paymentId: z.string().nullable().optional() }))) b: { paymentId?: string | null }) {
    return this.docs.checkReceipt(u, id, b.paymentId);
  }

  @Get('clients/:id/collection-letter.pdf')
  async letter(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const buf = await this.docs.letter(u, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="carta-cobranca-${id}.pdf"`);
    res.end(buf);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('clients/:id/dossier.pdf')
  async dossier(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const buf = await this.docs.dossier(u, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dossie-${id}.pdf"`);
    res.end(buf);
  }

  @Post('clients/:id/negativate')
  negativate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ mark: z.boolean() }))) b: { mark: boolean }) {
    return this.docs.negativate(u, id, b.mark);
  }

  @Put('clients/:id/whatsapp-opt-out')
  optOut(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ optOut: z.boolean() }))) b: { optOut: boolean }) {
    return this.docs.optOut(u, id, b.optOut);
  }
}
