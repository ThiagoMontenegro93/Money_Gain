import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FileInterceptor } from '@nestjs/platform-express';
import { brDateToISO, formatBRL, formatCPF, isoToBR, isValidISODate, parseBRL } from '@lendcontrol/core';
import { PaymentType } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import ExcelJS from 'exceljs';
import { Response } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { today, ZodPipe } from '../common/util';
import { PaymentsService } from '../payments/payments';
import { UsersService } from '../users/users';

/**
 * Fase 3: backup em Excel (7 abas para leitura/uso no dia a dia + aba oculta _DADOS com o banco completo),
 * envio por e-mail, exportação criptografada (.lcbak) e restauração validada.
 * Decisões 22-27 em docs/DECISOES.md.
 */

const SHEETS = ['1_CLIENTES', '2_EMPRESTIMOS', '3_PARCELAS', '4_PAGAMENTOS', '5_CARTEIRA_FUNCIONARIOS', '6_REPASSES', '7_RESUMO'] as const;
const DATA_SHEET = '_DADOS';
const DATA_MAGIC = 'LENDCONTROL_BACKUP_V1';
const ENC_MAGIC = Buffer.from('LCBAK1');
const FORMULA_ROWS = 500; // fórmulas prontas até a linha 501
const CHUNK = 30_000; // limite de caracteres por célula do Excel é 32.767
const TOKEN_TTL_MS = 30 * 60_000;
const MAX_UPLOAD = 50 * 1024 * 1024;
const VERSION = '6.5.0';
/** Tabelas que não voltam no tempo: trilha de auditoria atual e histórico de backups (decisão 24). */
const KEEP_TABLES = new Set(['_prisma_migrations', 'AuditLog', 'BackupLog']);
const SETTINGS_KEY = 'backup.email';

const TYPE_LABEL: Record<PaymentType, string> = { JUROS: 'Juros', QUITACAO: 'Quitação', AMORTIZACAO: 'Amortização', PARCELA: 'Parcela' };
const SCORE_FILL: Record<string, { bg: string; font: string }> = {
  BOM: { bg: 'FFC6EFCE', font: 'FF006100' },
  REGULAR: { bg: 'FFFFEB9C', font: 'FF9C5700' },
  RUIM: { bg: 'FFFFC7A0', font: 'FF833C0B' },
  PERDA: { bg: 'FF000000', font: 'FFFFFFFF' },
};

type Row = Record<string, unknown>;
interface DataPayload {
  meta: { app: 'LendControl Pro'; version: string; createdAt: string; tables: string[] };
  tables: Record<string, Row[]>;
}
interface OfflinePayment {
  row: number;
  loanCode: number;
  type: PaymentType;
  amountCents: number;
  paidAt: string;
}
interface PendingRestore {
  userId: string;
  fileName: string;
  createdAt: string;
  payload: DataPayload;
  offlinePayments: OfflinePayment[];
  expires: number;
}
export interface EmailConfig {
  enabled: boolean;
  email: string;
  extraEmails: string[];
}

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const settingsSchema = z.object({
  enabled: z.boolean(),
  email: z.string().trim().toLowerCase().max(200).refine((v) => v === '' || emailRx.test(v), 'E-mail inválido'),
  extraEmails: z.array(z.string().trim().toLowerCase().max(200).refine((v) => emailRx.test(v), 'E-mail adicional inválido')).max(10).default([]),
});

const pad = (n: number) => String(n).padStart(2, '0');
/** Data/hora em America/Sao_Paulo para nomes de arquivo e textos. */
function spParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}${p.minute}` };
}
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const isoOf = (v: unknown) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
/** ISO -> Date em UTC (para o Excel mostrar a data certa). */
const xd = (v: unknown) => {
  const s = isoOf(v);
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
};
const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------- criptografia do .lcbak
function encryptFile(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ENC_MAGIC, salt, iv, cipher.getAuthTag(), enc]);
}
function decryptFile(buf: Buffer, password: string): Buffer | null {
  try {
    const off = ENC_MAGIC.length;
    const salt = buf.subarray(off, off + 16);
    const iv = buf.subarray(off + 16, off + 28);
    const tag = buf.subarray(off + 28, off + 44);
    const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(buf.subarray(off + 44)), d.final()]);
  } catch {
    return null;
  }
}

@Injectable()
export class BackupsService {
  private readonly logger = new Logger('Backups');
  private readonly dir = resolve(process.env.STORAGE_DIR || './storage', 'backups');
  private readonly pending = new Map<string, PendingRestore>();
  private restoring = false;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private audit: AuditService,
    private mail: MailService,
    private settings: SettingsService,
    private users: UsersService,
    private payments: PaymentsService,
  ) {
    mkdirSync(this.dir, { recursive: true });
  }

  // ------------------------------------------------------------ listagem / configurações
  private dto(b: { id: string; fileName: string; sizeBytes: number; totalClientes: number; totalEmprestimos: number; totalParcelas: number; isAutomatic: boolean; isRestore: boolean; emailSentTo: string | null; createdById: string | null; createdAt: Date }, names: Map<string, string>) {
    return {
      id: b.id,
      fileName: b.fileName,
      sizeBytes: b.sizeBytes,
      totalClientes: b.totalClientes,
      totalEmprestimos: b.totalEmprestimos,
      totalParcelas: b.totalParcelas,
      isAutomatic: b.isAutomatic,
      isRestore: b.isRestore,
      emailSentTo: b.emailSentTo,
      createdAt: b.createdAt.toISOString(),
      available: !b.isRestore && existsSync(join(this.dir, b.fileName)),
      createdBy: b.createdById ? (names.get(b.createdById) ?? null) : b.isAutomatic ? 'Automático' : null,
    };
  }

  private async names(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async list() {
    const [backups, restores] = await Promise.all([
      this.prisma.backupLog.findMany({ where: { isRestore: false }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.backupLog.findMany({ where: { isRestore: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const names = await this.names([...backups, ...restores].map((b) => b.createdById));
    return { backups: backups.map((b) => this.dto(b, names)), restores: restores.map((b) => this.dto(b, names)), smtpConfigured: this.mail.configured };
  }

  getSettings(): Promise<EmailConfig> {
    return this.settings.get<EmailConfig>(SETTINGS_KEY, { enabled: false, email: '', extraEmails: [] });
  }

  async saveSettings(u: AuthUser, b: EmailConfig) {
    if (b.enabled && !b.email) throw new BadRequestException({ message: 'Informe o e-mail que vai receber o backup', code: 'VALIDATION' });
    const extra = [...new Set(b.extraEmails)].filter((e) => e !== b.email);
    const saved = await this.settings.set<EmailConfig>(SETTINGS_KEY, { enabled: b.enabled, email: b.email, extraEmails: extra });
    await this.audit.log(u.id, 'UPDATE', 'Setting', SETTINGS_KEY, { ...saved });
    return saved;
  }

  // ------------------------------------------------------------ geração
  /** Dump completo do banco (exceto auditoria e histórico de backups), tabela a tabela, em JSON do próprio PostgreSQL. */
  private async dumpData(): Promise<DataPayload> {
    const tables = await this.tableNames();
    const out: Record<string, Row[]> = {};
    for (const t of tables) {
      const r = await this.prisma.$queryRawUnsafe<{ rows: Row[] }[]>(`SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM "${t}" t`);
      out[t] = r[0]?.rows ?? [];
    }
    return { meta: { app: 'LendControl Pro', version: VERSION, createdAt: new Date().toISOString(), tables }, tables: out };
  }

  private async tableNames(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    return rows.map((r) => r.table_name).filter((t) => !KEEP_TABLES.has(t));
  }

  private async buildWorkbook(data: DataPayload): Promise<Buffer> {
    const T = data.tables;
    const users = new Map((T.User ?? []).map((u) => [u.id as string, u]));
    const clients = new Map((T.Client ?? []).map((cl) => [cl.id as string, cl]));
    const loans = new Map((T.Loan ?? []).map((l) => [l.id as string, l]));
    const uname = (id: unknown) => (id ? String(users.get(id as string)?.name ?? '') : '');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LendControl Pro';
    wb.created = new Date(data.meta.createdAt);
    const header = (ws: ExcelJS.Worksheet, cols: { header: string; key: string; width: number; fmt?: string }[]) => {
      ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const BRL = '"R$" #,##0.00';
    const DATE = 'dd/mm/yyyy';

    // 1_CLIENTES ----------------------------------------------------------
    const wsC = wb.addWorksheet('1_CLIENTES');
    header(wsC, [
      { header: 'Nome', key: 'nome', width: 32 },
      { header: 'CPF', key: 'cpf', width: 16 },
      { header: 'WhatsApp', key: 'whats', width: 16 },
      { header: 'Score', key: 'score', width: 8 },
      { header: 'Status', key: 'status', width: 11 },
      { header: 'Status AUTO', key: 'auto', width: 13 },
      { header: 'Cidade/UF', key: 'cidade', width: 20 },
      { header: 'Responsável', key: 'resp', width: 20 },
      { header: 'Limite', key: 'limite', width: 13, fmt: BRL },
      { header: 'Empréstimos ativos', key: 'ativos', width: 10 },
      { header: 'Saldo devedor', key: 'saldo', width: 14, fmt: BRL },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    const activeClients = (T.Client ?? []).filter((cl) => !cl.deletedAt).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'pt-BR'));
    activeClients.forEach((cl) => {
      let cpf = '';
      try {
        cpf = cl.cpfEncrypted ? formatCPF(this.crypto.decrypt(String(cl.cpfEncrypted))) : '';
      } catch {
        cpf = cl.cpfLast ? `***.***.*${cl.cpfLast}` : '';
      }
      const own = (T.Loan ?? []).filter((l) => l.clientId === cl.id && (l.status === 'ATIVO' || l.status === 'PERDA'));
      wsC.addRow({
        nome: cl.fullName,
        cpf,
        whats: cl.whatsapp ?? '',
        score: num(cl.score),
        status: cl.classificacao,
        cidade: [cl.city, cl.state].filter(Boolean).join('/'),
        resp: uname(cl.responsibleUserId),
        limite: cl.creditLimit === null || cl.creditLimit === undefined ? null : num(cl.creditLimit),
        ativos: own.length,
        saldo: own.reduce((s, l) => s + num(l.saldoDevedor), 0),
        id: cl.id,
      });
    });
    for (let r = 2; r <= FORMULA_ROWS + 1; r++) {
      const sc = wsC.getCell(`D${r}`).value;
      const result = typeof sc === 'number' ? (sc >= 8 ? 'BOM' : sc >= 5 ? 'REGULAR' : sc >= 2 ? 'RUIM' : 'PERDA') : '';
      wsC.getCell(`F${r}`).value = { formula: `IF(D${r}="","",IF(D${r}>=8,"BOM",IF(D${r}>=5,"REGULAR",IF(D${r}>=2,"RUIM","PERDA"))))`, result } as ExcelJS.CellFormulaValue;
    }
    wsC.addConditionalFormatting({
      ref: `A2:L${FORMULA_ROWS + 1}`,
      rules: (['PERDA', 'RUIM', 'REGULAR', 'BOM'] as const).map((s, i) => ({
        type: 'expression',
        priority: i + 1,
        formulae: [`$E2="${s}"`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SCORE_FILL[s].bg } }, font: { color: { argb: SCORE_FILL[s].font } } },
      })),
    });

    // 2_EMPRESTIMOS -------------------------------------------------------
    const wsL = wb.addWorksheet('2_EMPRESTIMOS');
    header(wsL, [
      { header: 'Código', key: 'code', width: 9 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Funcionário', key: 'func', width: 20 },
      { header: 'Valor', key: 'valor', width: 13, fmt: BRL },
      { header: 'Taxa %', key: 'taxa', width: 8 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Status', key: 'status', width: 11 },
      { header: 'Saldo devedor', key: 'saldo', width: 14, fmt: BRL },
      { header: 'Liberação', key: 'lib', width: 12, fmt: DATE },
      { header: 'Vencimento', key: 'venc', width: 12, fmt: DATE },
      { header: 'Total c/ juros', key: 'total', width: 14, fmt: BRL },
      { header: 'Modalidade', key: 'mod', width: 11 },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    const loanList = (T.Loan ?? []).filter((l) => !l.isProjection).sort((a, b) => num(a.code) - num(b.code));
    loanList.forEach((l) =>
      wsL.addRow({
        code: num(l.code),
        cliente: String(clients.get(l.clientId as string)?.fullName ?? ''),
        func: uname(l.lenderUserId),
        valor: num(l.principal),
        taxa: num(l.interestRate),
        tipo: l.type === 'INTEREST_ONLY' ? 'Só juros' : 'Parcela fixa',
        status: l.status,
        saldo: num(l.saldoDevedor),
        lib: xd(l.releaseDate),
        venc: xd(l.dueDate),
        mod: l.method,
        id: l.id,
      }),
    );
    for (let r = 2; r <= FORMULA_ROWS + 1; r++) {
      const v = wsL.getCell(`D${r}`).value;
      const e = wsL.getCell(`E${r}`).value;
      wsL.getCell(`K${r}`).value = { formula: `IF(D${r}="","",D${r}*(1+E${r}/100))`, result: typeof v === 'number' ? Math.round(v * (1 + num(e) / 100) * 100) / 100 : '' } as ExcelJS.CellFormulaValue;
      wsL.getCell(`K${r}`).numFmt = BRL;
    }

    // 3_PARCELAS ----------------------------------------------------------
    const wsP = wb.addWorksheet('3_PARCELAS');
    header(wsP, [
      { header: 'Empréstimo', key: 'code', width: 11 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Nº', key: 'n', width: 5 },
      { header: 'Vencimento', key: 'venc', width: 12, fmt: DATE },
      { header: 'Valor parcela', key: 'valor', width: 14, fmt: BRL },
      { header: 'Multa %/dia', key: 'multa', width: 10 },
      { header: 'Dias atraso', key: 'dias', width: 10 },
      { header: 'Status', key: 'status', width: 11 },
      { header: 'Tipo', key: 'tipo', width: 18 },
      { header: 'Valor atualizado', key: 'atual', width: 15, fmt: BRL },
      { header: 'Valor pago', key: 'pago', width: 13, fmt: BRL },
      { header: 'Pago em', key: 'pagoEm', width: 12, fmt: DATE },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    const inst = (T.Installment ?? [])
      .filter((i) => i.status !== 'CANCELADA')
      .map((i) => ({ i, l: loans.get(i.loanId as string) }))
      .sort((a, b) => num(a.l?.code) - num(b.l?.code) || num(a.i.number) - num(b.i.number));
    inst.forEach(({ i, l }) =>
      wsP.addRow({
        code: num(l?.code),
        cliente: String(clients.get(l?.clientId as string)?.fullName ?? ''),
        n: num(i.number),
        venc: xd(i.dueDate),
        valor: num(i.originalValue),
        multa: num(i.multaDiaPercent),
        status: i.status,
        tipo: i.type,
        pago: i.paidValue === null || i.paidValue === undefined ? null : num(i.paidValue),
        pagoEm: xd(i.paidAt),
        id: i.id,
      }),
    );
    for (let r = 2; r <= FORMULA_ROWS + 1; r++) {
      const st = wsP.getCell(`H${r}`).value;
      wsP.getCell(`G${r}`).value = { formula: `IF(OR(D${r}="",H${r}="PAGA"),0,MAX(0,TODAY()-D${r}))` } as ExcelJS.CellFormulaValue;
      wsP.getCell(`J${r}`).value = { formula: `IF(E${r}="","",E${r}*(1+F${r}/100*G${r}))` } as ExcelJS.CellFormulaValue;
      wsP.getCell(`J${r}`).numFmt = BRL;
      if (st === 'PENDENTE') wsP.getCell(`G${r}`).numFmt = '0';
    }

    // 4_PAGAMENTOS --------------------------------------------------------
    const wsPay = wb.addWorksheet('4_PAGAMENTOS');
    header(wsPay, [
      { header: 'Data', key: 'data', width: 12, fmt: DATE },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Empréstimo', key: 'code', width: 11 },
      { header: 'Tipo', key: 'tipo', width: 13 },
      { header: 'Valor', key: 'valor', width: 13, fmt: BRL },
      { header: 'Status', key: 'status', width: 22 },
      { header: 'Lançado por', key: 'por', width: 20 },
      { header: 'Aprovado por', key: 'aprov', width: 20 },
      { header: 'Observações', key: 'obs', width: 30 },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    (T.Payment ?? [])
      .slice()
      .sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)) || String(a.createdAt).localeCompare(String(b.createdAt)))
      .forEach((p) => {
        const l = loans.get(p.loanId as string);
        wsPay.addRow({
          data: xd(p.paidAt),
          cliente: String(clients.get(l?.clientId as string)?.fullName ?? ''),
          code: num(l?.code),
          tipo: TYPE_LABEL[p.type as PaymentType] ?? p.type,
          valor: num(p.value),
          status: p.status,
          por: uname(p.createdById),
          aprov: uname(p.approvedById),
          obs: p.notes ?? '',
          id: p.id,
        });
      });
    const payNote = wsPay.getCell('L1');
    payNote.value = 'Para lançar um pagamento recebido com o sistema fora do ar: preencha Data, Empréstimo, Tipo (Juros, Quitação, Amortização ou Parcela) e Valor numa linha nova, sem ID sistema. Na restauração ele vira recibo aguardando aprovação.';
    payNote.alignment = { wrapText: true, vertical: 'top' };
    wsPay.getColumn(12).width = 60;

    // 5_CARTEIRA_FUNCIONARIOS ---------------------------------------------
    const wsW = wb.addWorksheet('5_CARTEIRA_FUNCIONARIOS');
    header(wsW, [
      { header: 'Funcionário', key: 'nome', width: 24 },
      { header: 'Comissão %', key: 'com', width: 10 },
      { header: 'Capital total', key: 'total', width: 14, fmt: BRL },
      { header: 'Capital disponível', key: 'disp', width: 15, fmt: BRL },
      { header: 'Capital emprestado', key: 'emp', width: 15, fmt: BRL },
      { header: 'Recebido de clientes', key: 'rec', width: 15, fmt: BRL },
      { header: 'Para repassar ao dono', key: 'rep', width: 16, fmt: BRL },
      { header: 'Comissão a pagar', key: 'cpag', width: 14, fmt: BRL },
      { header: 'Em PERDA', key: 'perda', width: 13, fmt: BRL },
      { header: 'Livre (fórmula)', key: 'livre', width: 14, fmt: BRL },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    (T.User ?? [])
      .filter((u) => u.isActive !== false)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
      .forEach((u) => {
        const perda = (T.Loan ?? []).filter((l) => l.lenderUserId === u.id && l.status === 'PERDA').reduce((s, l) => s + num(l.saldoDevedor), 0);
        wsW.addRow({
          nome: u.name,
          com: num(u.commissionPercent),
          total: num(u.capitalDisponivel) + num(u.capitalEmprestado),
          disp: num(u.capitalDisponivel),
          emp: num(u.capitalEmprestado),
          rec: num(u.recebidoClientes),
          rep: num(u.paraRepassar),
          cpag: num(u.comissaoAPagar),
          perda,
          id: u.id,
        });
      });
    for (let r = 2; r <= FORMULA_ROWS + 1; r++) {
      wsW.getCell(`J${r}`).value = { formula: `IF(A${r}="","",C${r}-E${r}-I${r})` } as ExcelJS.CellFormulaValue;
      wsW.getCell(`J${r}`).numFmt = BRL;
    }

    // 6_REPASSES ----------------------------------------------------------
    const wsT = wb.addWorksheet('6_REPASSES');
    header(wsT, [
      { header: 'Data', key: 'data', width: 12, fmt: DATE },
      { header: 'Tipo', key: 'tipo', width: 20 },
      { header: 'De', key: 'de', width: 20 },
      { header: 'Para', key: 'para', width: 20 },
      { header: 'Valor', key: 'valor', width: 13, fmt: BRL },
      { header: 'Status', key: 'status', width: 22 },
      { header: 'Observações', key: 'obs', width: 30 },
      { header: 'ID sistema', key: 'id', width: 28 },
    ]);
    (T.CapitalTransfer ?? [])
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .forEach((t) =>
        wsT.addRow({ data: xd(t.createdAt), tipo: t.type, de: uname(t.fromUserId), para: uname(t.toUserId), valor: num(t.value), status: t.status, obs: t.notes ?? '', id: t.id }),
      );

    // 7_RESUMO ------------------------------------------------------------
    const wsR = wb.addWorksheet('7_RESUMO');
    wsR.getColumn(1).width = 42;
    wsR.getColumn(2).width = 20;
    const E = "'2_EMPRESTIMOS'";
    const P = "'3_PARCELAS'";
    const C = "'1_CLIENTES'";
    const lines: [string, string | Date | null, string?][] = [
      ['LendControl Pro - Resumo do backup', null],
      ['', null],
      ['Total emprestado (principal)', `SUM(${E}!D:D)`, BRL],
      ['Saldo devedor em aberto (ATIVO)', `SUMIFS(${E}!H:H,${E}!G:G,"ATIVO")`, BRL],
      ['Perdas (saldo em PERDA)', `SUMIFS(${E}!H:H,${E}!G:G,"PERDA")`, BRL],
      ['Empréstimos ativos', `COUNTIF(${E}!G:G,"ATIVO")`],
      ['Empréstimos quitados', `COUNTIF(${E}!G:G,"QUITADO")`],
      ['Clientes BOM', `COUNTIF(${C}!E:E,"BOM")`],
      ['Clientes REGULAR', `COUNTIF(${C}!E:E,"REGULAR")`],
      ['Clientes RUIM', `COUNTIF(${C}!E:E,"RUIM")`],
      ['Clientes PERDA', `COUNTIF(${C}!E:E,"PERDA")`],
      ['Parcelas pendentes', `COUNTIF(${P}!H:H,"PENDENTE")`],
      ['Parcelas pendentes - valor atualizado', `SUMIFS(${P}!J:J,${P}!H:H,"PENDENTE")`, BRL],
      ['Pagamentos aprovados (total)', `SUMIFS('4_PAGAMENTOS'!E:E,'4_PAGAMENTOS'!F:F,"APROVADO")`, BRL],
      ['', null],
      ['Datas', null],
      ['Data do backup', xd(spParts(new Date(data.meta.createdAt)).date)],
      ['Daqui a 1 mês', `EDATE($B$17,1)`, DATE],
      ['Daqui a 3 meses', `EDATE($B$17,3)`, DATE],
      ['Daqui a 6 meses', `EDATE($B$17,6)`, DATE],
      ['Parcelas vencendo nos próximos 3 meses', `SUMIFS(${P}!E:E,${P}!H:H,"PENDENTE",${P}!D:D,">="&$B$17,${P}!D:D,"<"&EDATE($B$17,3))`, BRL],
    ];
    lines.forEach(([label, v, fmt], i) => {
      const r = wsR.getRow(i + 1);
      r.getCell(1).value = label;
      if (v instanceof Date) {
        r.getCell(2).value = v;
        r.getCell(2).numFmt = DATE;
      } else if (typeof v === 'string') {
        r.getCell(2).value = { formula: v } as ExcelJS.CellFormulaValue;
        if (fmt) r.getCell(2).numFmt = fmt;
      }
    });
    wsR.getRow(1).font = { bold: true, size: 14 };
    wsR.getRow(16).font = { bold: true };

    // _DADOS (oculta) -----------------------------------------------------
    const json = Buffer.from(JSON.stringify(data));
    const b64 = gzipSync(json).toString('base64');
    const wsD = wb.addWorksheet(DATA_SHEET, { state: 'veryHidden' });
    wsD.getCell('A1').value = DATA_MAGIC;
    wsD.getCell('A2').value = JSON.stringify({ ...data.meta, sha256: createHash('sha256').update(json).digest('hex'), chunks: Math.ceil(b64.length / CHUNK) });
    for (let i = 0, r = 3; i < b64.length; i += CHUNK, r++) wsD.getCell(`A${r}`).value = b64.slice(i, i + CHUNK);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Gera um backup agora (manual, automático ou "antes-da-restauracao"). */
  async create(u: AuthUser | null, opts: { automatic?: boolean; label?: string } = {}) {
    const data = await this.dumpData();
    const buf = await this.buildWorkbook(data);
    const { date, time } = spParts(new Date(data.meta.createdAt));
    let fileName = `lendcontrol-backup-${opts.label ? `${opts.label}-` : ''}${date}-${time}.xlsx`;
    for (let n = 2; existsSync(join(this.dir, fileName)); n++) fileName = fileName.replace(/(-\d+)?\.xlsx$/, `-${n}.xlsx`);
    writeFileSync(join(this.dir, fileName), buf, { mode: 0o600 });
    const T = data.tables;
    const log = await this.prisma.backupLog.create({
      data: {
        fileName,
        fileUrl: `private://backups/${fileName}`,
        sizeBytes: buf.length,
        totalClientes: (T.Client ?? []).filter((cl) => !cl.deletedAt).length,
        totalEmprestimos: (T.Loan ?? []).filter((l) => !l.isProjection).length,
        totalParcelas: (T.Installment ?? []).filter((i) => i.status !== 'CANCELADA').length,
        isAutomatic: !!opts.automatic,
        createdById: u?.id ?? null,
      },
    });
    await this.audit.log(u?.id ?? null, 'BACKUP', 'BackupLog', log.id, { fileName, sizeBytes: buf.length, automatic: !!opts.automatic });
    this.logger.log(`Backup gerado: ${fileName} (${buf.length} bytes)`);
    return this.dto(log, await this.names([log.createdById]));
  }

  async file(id: string) {
    const b = await this.prisma.backupLog.findUnique({ where: { id } });
    if (!b || b.isRestore) throw new NotFoundException('Backup não encontrado');
    const path = join(this.dir, b.fileName);
    if (!existsSync(path)) throw new NotFoundException('Arquivo do backup não está mais disponível no servidor');
    return { log: b, path, buf: readFileSync(path) };
  }

  async download(u: AuthUser, id: string) {
    const f = await this.file(id);
    await this.audit.log(u.id, 'DOWNLOAD', 'BackupLog', id, { fileName: f.log.fileName });
    return { name: f.log.fileName, buf: f.buf };
  }

  async encrypted(u: AuthUser, id: string, password: string) {
    const f = await this.file(id);
    await this.audit.log(u.id, 'DOWNLOAD_ENCRYPTED', 'BackupLog', id, { fileName: f.log.fileName });
    return { name: f.log.fileName.replace(/\.xlsx$/, '.lcbak'), buf: encryptFile(f.buf, password) };
  }

  async email(u: AuthUser | null, id: string) {
    const cfg = await this.getSettings();
    const to = [cfg.email, ...cfg.extraEmails].filter(Boolean);
    if (!to.length) throw new BadRequestException({ message: 'Configure o e-mail que vai receber o backup', code: 'NO_BACKUP_EMAIL' });
    const f = await this.file(id);
    const when = new Date(f.log.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await this.mail.send(
      to,
      `LendControl - Backup ${when}`,
      `Segue em anexo o backup do LendControl Pro gerado em ${when}: ${f.log.totalClientes} clientes, ${f.log.totalEmprestimos} empréstimos, ${f.log.totalParcelas} parcelas.\n\n` +
        `ATENÇÃO: a planilha contém dados pessoais (CPF completo). Guarde em local seguro e não encaminhe.\n` +
        `Para restaurar: Configurações > Backup > Restaurar backup.`,
      [{ filename: f.log.fileName, content: f.buf, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    );
    const sentTo = to.join(', ');
    const log = await this.prisma.backupLog.update({ where: { id }, data: { emailSentTo: sentTo } });
    await this.audit.log(u?.id ?? null, 'BACKUP_EMAIL', 'BackupLog', id, { to: sentTo });
    return this.dto(log, await this.names([log.createdById]));
  }

  async testEmail(u: AuthUser) {
    const cfg = await this.getSettings();
    if (!cfg.email) throw new BadRequestException({ message: 'Configure o e-mail que vai receber o backup', code: 'NO_BACKUP_EMAIL' });
    if (!this.mail.configured) throw new BadRequestException({ message: 'Servidor de e-mail não configurado (defina SMTP_URL no servidor)', code: 'SMTP_NOT_CONFIGURED' });
    const b = await this.create(u);
    return this.email(u, b.id);
  }

  /** Toda segunda 08:00 (America/Sao_Paulo): backup automático e envio por e-mail, se ativo. */
  @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo', name: 'weekly-backup' })
  async weekly() {
    try {
      const b = await this.create(null, { automatic: true });
      const cfg = await this.getSettings();
      if (cfg.enabled && cfg.email && this.mail.configured) await this.email(null, b.id);
    } catch (e) {
      this.logger.error(`Backup automático falhou: ${(e as Error).stack}`);
      await this.audit.notifyAdmins('Backup automático falhou', (e as Error).message).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------ restauração
  private purgeTokens() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
  }

  async preview(u: AuthUser, file: Express.Multer.File | undefined, filePassword?: string) {
    const base = { token: null as string | null, valid: false, encrypted: false, fileName: file?.originalname ?? '', backupCreatedAt: null as string | null, summary: null as string | null, counts: {} as Record<string, number>, errors: [] as string[], warnings: [] as string[], distribution: [] as string[], offlinePayments: [] as OfflinePayment[] };
    if (!file?.buffer?.length) throw new BadRequestException('Envie o arquivo do backup no campo "file"');
    let buf = file.buffer;
    if (buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
      base.encrypted = true;
      if (!filePassword) return { ...base, code: 'FILE_PASSWORD_REQUIRED', errors: ['Backup criptografado: informe a senha do arquivo'] };
      const plain = decryptFile(buf, filePassword);
      if (!plain) return { ...base, code: 'FILE_PASSWORD_WRONG', errors: ['Senha do arquivo incorreta (ou arquivo corrompido)'] };
      buf = plain;
    }
    const wb = new ExcelJS.Workbook();
    try {
      if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('not zip');
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      return { ...base, errors: ['O arquivo não é uma planilha do Excel (.xlsx) gerada pelo LendControl'] };
    }
    const errors: string[] = [];
    for (const s of [...SHEETS, DATA_SHEET]) if (!wb.getWorksheet(s)) errors.push(`Aba ${s} não encontrada`);
    if (errors.length) return { ...base, errors: errors.some((e) => e.includes(DATA_SHEET)) && errors.length === SHEETS.length + 1 ? ['O arquivo não é uma planilha de backup do LendControl'] : errors };

    // dados completos da aba oculta
    let payload: DataPayload;
    try {
      const ws = wb.getWorksheet(DATA_SHEET)!;
      if (String(ws.getCell('A1').value) !== DATA_MAGIC) throw new Error('magic');
      const meta = JSON.parse(String(ws.getCell('A2').value)) as { sha256: string; chunks: number };
      let b64 = '';
      for (let r = 3; r < 3 + meta.chunks; r++) b64 += String(ws.getCell(`A${r}`).value ?? '');
      const json = gunzipSync(Buffer.from(b64, 'base64'));
      if (createHash('sha256').update(json).digest('hex') !== meta.sha256) throw new Error('sha');
      payload = JSON.parse(json.toString('utf8')) as DataPayload;
      if (!payload?.tables?.User?.length) throw new Error('vazio');
    } catch {
      return { ...base, errors: ['Os dados internos do backup (aba _DADOS) estão ausentes ou foram alterados - não é possível restaurar com segurança'] };
    }
    const T = payload.tables;
    const missing = (await this.tableNames()).filter((t) => !(t in T));
    const warnings: string[] = [];
    if (payload.meta.version !== VERSION) warnings.push(`Backup gerado pela versão ${payload.meta.version} (sistema atual ${VERSION})`);
    if (missing.length) warnings.push(`Sem dados no backup para: ${missing.join(', ')} (ficarão vazios)`);
    warnings.push('Edições feitas à mão nas abas não são importadas, exceto pagamentos novos na aba 4_PAGAMENTOS');
    warnings.push('Fotos e comprovantes continuam no servidor; a trilha de auditoria atual é mantida');

    // pagamentos lançados à mão na aba 4 (sem ID sistema)
    const offlinePayments: OfflinePayment[] = [];
    const loanCodes = new Set((T.Loan ?? []).map((l) => num(l.code)));
    const ws4 = wb.getWorksheet('4_PAGAMENTOS')!;
    ws4.eachRow((r, n) => {
      if (n === 1) return;
      const idCell = r.getCell(10).value;
      const codeV = r.getCell(3).value;
      const valV = r.getCell(5).value;
      if (idCell || (codeV === null && valV === null)) return;
      const code = Number(typeof codeV === 'object' && codeV && 'result' in codeV ? codeV.result : codeV);
      const typeRaw = String(r.getCell(4).value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
      const type = (['JUROS', 'QUITACAO', 'AMORTIZACAO', 'PARCELA'] as PaymentType[]).find((t) => t === typeRaw);
      let amountCents: number | null = null;
      if (typeof valV === 'number') amountCents = Math.round(valV * 100);
      else if (typeof valV === 'string') amountCents = parseBRL(valV);
      const dv = r.getCell(1).value;
      let paidAt: string | null = null;
      if (dv instanceof Date) paidAt = dv.toISOString().slice(0, 10);
      else if (typeof dv === 'string') paidAt = brDateToISO(dv) ?? (isValidISODate(dv.trim()) ? dv.trim() : null);
      else if (dv === null || dv === undefined) paidAt = today();
      if (paidAt && paidAt > today()) paidAt = today();
      const problems: string[] = [];
      if (!code || !loanCodes.has(code)) problems.push(`empréstimo "${codeV ?? ''}" não existe no backup`);
      if (!type) problems.push(`tipo "${r.getCell(4).value ?? ''}" inválido (use Juros, Quitação, Amortização ou Parcela)`);
      if (!amountCents || amountCents <= 0) problems.push('valor inválido');
      if (!paidAt) problems.push('data inválida');
      if (problems.length) warnings.push(`Linha ${n} da aba 4_PAGAMENTOS ignorada: ${problems.join('; ')}`);
      else offlinePayments.push({ row: n, loanCode: code, type: type!, amountCents: amountCents!, paidAt: paidAt! });
    });

    const counts = {
      clientes: (T.Client ?? []).filter((cl) => !cl.deletedAt).length,
      emprestimos: (T.Loan ?? []).filter((l) => !l.isProjection).length,
      parcelas: (T.Installment ?? []).filter((i) => i.status !== 'CANCELADA').length,
      pagamentos: (T.Payment ?? []).length,
      usuarios: (T.User ?? []).length,
      repasses: (T.CapitalTransfer ?? []).length,
      documentos: (T.Document ?? []).length,
      mensagens: (T.MessageLog ?? []).length,
    };
    const createdAt = payload.meta.createdAt;
    const distribution = [
      `${counts.clientes} clientes -> área Clientes`,
      `${counts.emprestimos} empréstimos -> área Empréstimos`,
      `${counts.parcelas} parcelas -> cronograma dos empréstimos`,
      `${counts.pagamentos} pagamentos -> histórico e Aprovações`,
      `${counts.usuarios} usuários -> Equipe (logins e carteiras)`,
      `${counts.repasses} repasses -> Carteira`,
      `${counts.documentos} documentos -> ficha do cliente`,
      `${counts.mensagens} mensagens -> histórico do WhatsApp`,
    ];
    this.purgeTokens();
    const token = randomBytes(24).toString('hex');
    this.pending.set(token, { userId: u.id, fileName: file.originalname, createdAt, payload, offlinePayments, expires: Date.now() + TOKEN_TTL_MS });
    await this.audit.log(u.id, 'RESTORE_PREVIEW', 'BackupLog', null, { fileName: file.originalname, backupCreatedAt: createdAt, ...counts });
    return {
      ...base,
      token,
      valid: true,
      backupCreatedAt: createdAt,
      summary: `Planilha de ${isoToBR(spParts(new Date(createdAt)).date)} encontrada - ${counts.clientes} clientes, ${counts.emprestimos} empréstimos, ${counts.parcelas} parcelas - Confere?`,
      counts,
      distribution,
      warnings,
      offlinePayments,
    };
  }

  async restore(u: AuthUser, token: string, password: string) {
    await this.users.verifyPassword(u.id, password);
    this.purgeTokens();
    const p = this.pending.get(token);
    if (!p || p.userId !== u.id) throw new BadRequestException({ message: 'Validação expirada ou já usada. Valide a planilha novamente', code: 'RESTORE_TOKEN_INVALID' });
    if (this.restoring) throw new BadRequestException({ message: 'Já existe uma restauração em andamento', code: 'RESTORE_RUNNING' });
    this.pending.delete(token);
    this.restoring = true;
    try {
      // 1) cópia de segurança do estado atual
      const safety = await this.create(u, { label: 'antes-da-restauracao' });
      // 2) substitui os dados (transação única; FKs conferidas no fim pela consistência do próprio dump)
      const T = p.payload.tables;
      const current = await this.tableNames();
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
          for (const t of current) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
          for (const t of current) {
            const rows = T[t];
            if (!rows?.length) continue;
            const colsRes = await tx.$queryRawUnsafe<{ column_name: string }[]>(
              `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
              t,
            );
            const cols = colsRes.map((x) => x.column_name).filter((col) => col in rows[0]);
            const list = cols.map((col) => `"${col}"`).join(', ');
            await tx.$executeRawUnsafe(`INSERT INTO "${t}" (${list}) SELECT ${list} FROM json_populate_recordset(NULL::"${t}", $1::json)`, JSON.stringify(rows));
          }
          // sequências (ex.: código do empréstimo) continuam depois do maior valor restaurado
          const seqs = await tx.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
            `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_default LIKE 'nextval%'`,
          );
          for (const s of seqs) {
            await tx.$executeRawUnsafe(
              `SELECT setval(pg_get_serial_sequence('"${s.table_name}"', '${s.column_name}'), COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"), 0) + 1, false)`,
            );
          }
          // auditoria atual é mantida; referências a usuários que não existem no backup ficam sem usuário
          await tx.$executeRawUnsafe(`UPDATE "AuditLog" SET "userId" = NULL WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "User")`);
        },
        { timeout: 300_000, maxWait: 30_000 },
      );

      // 3) quem está restaurando continua valendo? (senão o app pede novo login)
      const me = await this.prisma.user.findUnique({ where: { id: u.id } });
      const reloginRequired = !me || !me.isActive || me.role !== 'SUPER_ADMIN';
      const actor = me && me.isActive ? { id: me.id, role: me.role, name: me.name } : await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, role: true, name: true } });

      // 4) pagamentos lançados à mão na planilha -> recibos aguardando aprovação
      const created: string[] = [];
      const skipped: string[] = [];
      for (const op of p.offlinePayments) {
        const label = `Empréstimo ${op.loanCode}: ${TYPE_LABEL[op.type]} ${formatBRL(op.amountCents)} em ${isoToBR(op.paidAt)}`;
        try {
          if (!actor) throw new Error('nenhum Super Admin ativo no backup');
          const loan = await this.prisma.loan.findUnique({ where: { code: op.loanCode } });
          if (!loan) throw new Error('empréstimo não encontrado');
          await this.payments.create(actor, {
            loanId: loan.id,
            type: op.type,
            amountCents: op.amountCents,
            paidAt: op.paidAt,
            notes: `Lançado na planilha de backup (${p.fileName}, aba 4_PAGAMENTOS, linha ${op.row})`,
          });
          created.push(`${label} → recibo aguardando aprovação`);
        } catch (e) {
          skipped.push(`${label} não lançado: ${(e as Error).message}`);
        }
      }

      const counts = {
        clientes: (T.Client ?? []).filter((cl) => !cl.deletedAt).length,
        emprestimos: (T.Loan ?? []).filter((l) => !l.isProjection).length,
        parcelas: (T.Installment ?? []).filter((i) => i.status !== 'CANCELADA').length,
        pagamentos: (T.Payment ?? []).length,
        usuarios: (T.User ?? []).length,
      };
      await this.prisma.backupLog.create({
        data: {
          fileName: p.fileName,
          fileUrl: 'restore://',
          sizeBytes: 0,
          totalClientes: counts.clientes,
          totalEmprestimos: counts.emprestimos,
          totalParcelas: counts.parcelas,
          isRestore: true,
          createdById: me ? u.id : null,
        },
      });
      await this.audit.log(me ? u.id : null, 'RESTORE', 'System', null, {
        fileName: p.fileName,
        backupCreatedAt: p.createdAt,
        safetyBackupId: safety.id,
        restoredBy: u.name,
        counts,
        offlinePaymentsCreated: created.length,
        offlinePaymentsSkipped: skipped.length,
      });
      this.logger.warn(`Sistema restaurado por ${u.name} a partir de ${p.fileName} (backup de segurança ${safety.fileName})`);
      return { message: '✅ Sistema restaurado com sucesso', safetyBackupId: safety.id, counts, offlinePaymentsCreated: created, offlinePaymentsSkipped: skipped, reloginRequired };
    } finally {
      this.restoring = false;
    }
  }
}

const sendFile = (res: Response, name: string, buf: Buffer, type: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
};

@Controller('backups')
@Roles('SUPER_ADMIN')
export class BackupsController {
  constructor(private backups: BackupsService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Post()
  create(@CurrentUser() u: AuthUser) {
    return this.backups.create(u);
  }

  @Get('settings')
  settings() {
    return this.backups.getSettings();
  }

  @Put('settings')
  saveSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: EmailConfig) {
    return this.backups.saveSettings(u, b);
  }

  @Post('settings/test')
  test(@CurrentUser() u: AuthUser) {
    return this.backups.testEmail(u);
  }

  @Post('restore/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }))
  preview(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body('filePassword') filePassword?: string) {
    return this.backups.preview(u, file, filePassword || undefined);
  }

  @Post('restore')
  restore(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ token: z.string().min(1), password: z.string() }))) b: { token: string; password: string }) {
    return this.backups.restore(u, b.token, b.password);
  }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const f = await this.backups.download(u, id);
    sendFile(res, f.name, f.buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  @Post(':id/encrypted')
  @HttpCode(200)
  async encrypted(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ password: z.string().min(8, 'A senha do arquivo precisa ter ao menos 8 caracteres') }))) b: { password: string }, @Res() res: Response) {
    const f = await this.backups.encrypted(u, id, b.password);
    sendFile(res, f.name, f.buf, 'application/octet-stream');
  }

  @Post(':id/email')
  email(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.backups.email(u, id);
  }
}
