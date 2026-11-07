import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClientForm,
  collectionStrategies,
  evaluateCreditLock,
  formatCPF,
  formProgress,
  isValidCPF,
  maskCPF,
  onlyDigits,
  pct,
  priceSchedule,
  RESIDENCE_TIMES,
  RELATIONS,
  suggestLimitIncrease,
  suggestRateDiscount,
  validateClientForm,
  diffDays,
} from '@lendcontrol/core';
import { Client, ClientScore, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser, isAdmin } from '../common/auth';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { c, cn, d, dt, iso, num, today } from '../common/util';
import { loanInclude, loanSummary } from '../loans/loan-mapper';
import { UsersService } from '../users/users';
import { ScoreService } from './score.service';

/** Trava de crédito considerando desbloqueio manual do Super Admin. */
export function creditLockFor(
  cl: Pick<Client, 'score' | 'classificacao' | 'isBlocked' | 'pontualidade' | 'unblockedAt'>,
  r: { diasSemPagar: number; openDebtCents: number },
) {
  const lock = evaluateCreditLock({
    score: cl.score,
    classificacao: cl.classificacao,
    isBlocked: cl.isBlocked,
    pontualidade: cl.pontualidade === null ? null : num(cl.pontualidade),
    diasSemPagar: r.diasSemPagar,
    openDebtCents: r.openDebtCents,
  });
  if (lock.level === 'BLOCKED' && !cl.isBlocked && cl.unblockedAt)
    return {
      level: 'WARNING' as const,
      title: '⚠️ Cliente PERDA desbloqueado pelo Super Admin',
      message: `Desbloqueado em ${cl.unblockedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Empreste com cautela: histórico de perda.`,
    };
  return lock;
}

const CLASS_ORDER: Record<ClientScore, number> = { BOM: 0, REGULAR: 1, RUIM: 2, PERDA: 3 };

export interface ListFilters {
  search?: string;
  classificacao?: ClientScore;
  overdue?: boolean;
  responsibleUserId?: string;
  status?: 'RASCUNHO' | 'ATIVO' | 'INATIVO';
}

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private audit: AuditService,
    private score: ScoreService,
    private users: UsersService,
  ) {}

  /** OPERATOR só enxerga clientes sob sua responsabilidade ou com empréstimos dele. */
  scope(u: AuthUser): Prisma.ClientWhereInput {
    const base: Prisma.ClientWhereInput = { deletedAt: null };
    if (isAdmin(u)) return base;
    return { ...base, OR: [{ responsibleUserId: u.id }, { loans: { some: { lenderUserId: u.id } } }] };
  }

  async assertAccess(u: AuthUser, clientId: string) {
    const found = await this.prisma.client.findFirst({ where: { id: clientId, ...this.scope(u) }, select: { id: true } });
    if (!found) throw new NotFoundException('Cliente não encontrado');
  }

  // -------------------------------------------------------------------------
  // Mapeamento ficha <-> banco
  // -------------------------------------------------------------------------

  private formToData(form: Partial<ClientForm>): Prisma.ClientUncheckedCreateInput | Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const str = (v: unknown) => (v === undefined ? undefined : v === null || String(v).trim() === '' ? null : String(v).trim());
    const plain: (keyof ClientForm)[] = [
      'fullName', 'rg', 'rgIssuer', 'selfieFileId', 'notes', 'whatsapp', 'whatsapp2', 'cep', 'street', 'number',
      'complement', 'district', 'city', 'state', 'reference', 'residenceTime', 'pixKey', 'pixType', 'profession',
      'workplace', 'emergencyName', 'emergencyRelation', 'emergencyPhone1', 'emergencyPhone2', 'guarantorName',
      'guarantorPhone', 'guarantorRelation', 'guarantorClientId', 'guarantorDocFileId', 'referrerName', 'referrerPhone',
      'referrerClientId', 'responsibleUserId',
    ];
    for (const k of plain) if (k in form) data[k] = str(form[k]);
    if (data.state) data.state = String(data.state).toUpperCase().slice(0, 2);
    if ('birthDate' in form) data.birthDate = form.birthDate ? dt(form.birthDate) : null;
    if ('incomeCents' in form) data.income = form.incomeCents == null ? null : d(form.incomeCents);
    if ('creditLimitCents' in form) data.creditLimit = form.creditLimitCents == null ? null : d(form.creditLimitCents);
    if ('internalScore' in form) data.internalScore = form.internalScore ?? null;
    if ('hasGuarantor' in form) data.hasGuarantor = !!form.hasGuarantor;
    if (form.source) data.source = form.source;
    if (form.whatsappImportedAt) data.whatsappImportedAt = new Date(form.whatsappImportedAt);
    if (form.source === 'WHATSAPP' && !form.whatsappImportedAt) data.whatsappImportedAt = new Date();
    if (form.lgpdConsent) {
      data.lgpdConsentAt = new Date();
      data.lgpdConsentVersion = 'v1-2026';
    }
    // CPF: só grava se vier um CPF completo (o front recebe mascarado e não deve reenviar a máscara)
    if (form.cpf !== undefined) {
      const digits = onlyDigits(form.cpf);
      if (digits.length === 11) {
        data.cpfEncrypted = this.crypto.encrypt(digits);
        data.cpfHash = this.crypto.hash(digits);
        data.cpfLast = digits.slice(-5);
      } else if (!form.cpf) {
        Object.assign(data, { cpfEncrypted: null, cpfHash: null, cpfLast: null });
      }
    }
    if (form.guarantorCpf !== undefined) {
      const digits = onlyDigits(form.guarantorCpf);
      if (digits.length === 11) {
        data.guarantorCpfEncrypted = this.crypto.encrypt(digits);
        data.guarantorCpfLast = digits.slice(-5);
      } else if (!form.guarantorCpf) Object.assign(data, { guarantorCpfEncrypted: null, guarantorCpfLast: null });
    }
    if (form.hasGuarantor === false) {
      Object.assign(data, {
        guarantorName: null, guarantorPhone: null, guarantorRelation: null, guarantorClientId: null,
        guarantorCpfEncrypted: null, guarantorCpfLast: null, guarantorDocFileId: null,
      });
    }
    return data;
  }

  private maskedCpf(cl: Pick<Client, 'cpfEncrypted'>) {
    return cl.cpfEncrypted ? maskCPF(this.crypto.decrypt(cl.cpfEncrypted)) : '';
  }

  private toForm(cl: Client): ClientForm {
    return {
      fullName: cl.fullName,
      cpf: this.maskedCpf(cl),
      rg: cl.rg,
      rgIssuer: cl.rgIssuer,
      birthDate: iso(cl.birthDate) ?? '',
      selfieFileId: cl.selfieFileId,
      notes: cl.notes,
      whatsapp: cl.whatsapp ?? '',
      whatsapp2: cl.whatsapp2,
      cep: cl.cep ?? '',
      street: cl.street ?? '',
      number: cl.number ?? '',
      complement: cl.complement,
      district: cl.district ?? '',
      city: cl.city ?? '',
      state: cl.state ?? '',
      reference: cl.reference,
      residenceTime: cl.residenceTime as ClientForm['residenceTime'],
      pixKey: cl.pixKey ?? '',
      pixType: (cl.pixType ?? 'CPF') as ClientForm['pixType'],
      profession: cl.profession,
      incomeCents: cn(cl.income),
      workplace: cl.workplace,
      internalScore: cl.internalScore,
      creditLimitCents: cn(cl.creditLimit),
      emergencyName: cl.emergencyName ?? '',
      emergencyRelation: (cl.emergencyRelation ?? 'OUTRO') as ClientForm['emergencyRelation'],
      emergencyPhone1: cl.emergencyPhone1 ?? '',
      emergencyPhone2: cl.emergencyPhone2,
      hasGuarantor: cl.hasGuarantor,
      guarantorName: cl.guarantorName,
      guarantorCpf: cl.guarantorCpfEncrypted ? maskCPF(this.crypto.decrypt(cl.guarantorCpfEncrypted)) : null,
      guarantorPhone: cl.guarantorPhone,
      guarantorRelation: cl.guarantorRelation as ClientForm['guarantorRelation'],
      guarantorClientId: cl.guarantorClientId,
      guarantorDocFileId: cl.guarantorDocFileId,
      referrerName: cl.referrerName,
      referrerPhone: cl.referrerPhone,
      referrerClientId: cl.referrerClientId,
      source: cl.source,
      whatsappImportedAt: cl.whatsappImportedAt?.toISOString() ?? null,
      lgpdConsent: !!cl.lgpdConsentAt,
      responsibleUserId: cl.responsibleUserId,
    };
  }

  // -------------------------------------------------------------------------
  // Listagem
  // -------------------------------------------------------------------------

  private listItem(
    cl: Client & { responsible: { id: string; name: string } | null; loans: Parameters<typeof loanSummary>[0][] },
  ) {
    const asOf = today();
    const summaries = cl.loans.map((l) => loanSummary(l, asOf));
    const active = summaries.filter((l) => l.status === 'ATIVO' || l.status === 'PERDA');
    return {
      id: cl.id,
      fullName: cl.fullName,
      cpfMasked: this.maskedCpf(cl),
      whatsapp: cl.whatsapp,
      city: cl.city,
      status: cl.status,
      score: cl.score,
      classificacao: cl.classificacao,
      pontualidade: cl.pontualidade === null ? null : num(cl.pontualidade),
      diasSemPagar: cl.diasSemPagar,
      isBlocked: cl.isBlocked,
      responsible: cl.responsible,
      activeLoans: active.length,
      totalEmprestadoCents: active.reduce((s, l) => s + l.principalCents, 0),
      emAbertoCents: active.reduce((s, l) => s + l.saldoDevedorCents, 0),
      overdueCount: active.reduce((s, l) => s + l.overdueCount, 0),
      createdAt: cl.createdAt.toISOString(),
    };
  }

  private listInclude = {
    responsible: { select: { id: true, name: true } },
    loans: { where: { status: { not: 'CANCELADO' as const } }, include: loanInclude },
  };

  async list(u: AuthUser, f: ListFilters) {
    const where: Prisma.ClientWhereInput = { ...this.scope(u) };
    const and: Prisma.ClientWhereInput[] = [];
    if (f.search) {
      const s = f.search.trim();
      const digits = onlyDigits(s);
      const or: Prisma.ClientWhereInput[] = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
      ];
      if (digits.length >= 4) or.push({ whatsapp: { contains: digits.slice(-4) } }, { cpfLast: { endsWith: digits.slice(-5) } });
      if (digits.length === 11) or.push({ cpfHash: this.crypto.hash(digits) });
      and.push({ OR: or });
    }
    if (f.responsibleUserId) and.push({ responsibleUserId: f.responsibleUserId });
    if (f.status) and.push({ status: f.status });
    if (and.length) where.AND = and;
    const rows = await this.prisma.client.findMany({ where, include: this.listInclude, take: 2000 });
    const all = rows.map((r) => this.listItem(r));
    const counts = {
      all: all.length,
      BOM: all.filter((x) => x.classificacao === 'BOM').length,
      REGULAR: all.filter((x) => x.classificacao === 'REGULAR').length,
      RUIM: all.filter((x) => x.classificacao === 'RUIM').length,
      PERDA: all.filter((x) => x.classificacao === 'PERDA').length,
      atrasados: all.filter((x) => x.overdueCount > 0).length,
    };
    let items = all;
    if (f.classificacao) items = items.filter((x) => x.classificacao === f.classificacao);
    if (f.overdue) items = items.filter((x) => x.overdueCount > 0);
    items.sort(
      (a, b) =>
        CLASS_ORDER[a.classificacao] - CLASS_ORDER[b.classificacao] || b.score - a.score || a.fullName.localeCompare(b.fullName, 'pt-BR'),
    );
    return { items, counts };
  }

  async item(id: string) {
    const cl = await this.prisma.client.findUniqueOrThrow({ where: { id }, include: this.listInclude });
    return this.listItem(cl);
  }

  async lookup(u: AuthUser, q: string) {
    if (!q || q.trim().length < 2) return [];
    const digits = onlyDigits(q);
    const rows = await this.prisma.client.findMany({
      where: {
        ...this.scope(u),
        OR: [
          { fullName: { contains: q.trim(), mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ whatsapp: { contains: digits.slice(-4) } }] : []),
          ...(digits.length === 11 ? [{ cpfHash: this.crypto.hash(digits) }] : []),
        ],
      },
      take: 10,
      orderBy: { fullName: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      whatsapp: r.whatsapp,
      classificacao: r.classificacao,
      since: r.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Detalhe
  // -------------------------------------------------------------------------

  async detail(u: AuthUser, id: string) {
    await this.assertAccess(u, id);
    const cl = await this.prisma.client.findUniqueOrThrow({
      where: { id },
      include: {
        ...this.listInclude,
        history: { orderBy: { createdAt: 'desc' }, take: 50, include: { user: { select: { name: true } } } },
        collectionAttempts: { orderBy: { date: 'desc' }, include: { user: { select: { name: true } } } },
        guarantorClient: { select: { id: true, fullName: true } },
        referrerClient: { select: { id: true, fullName: true, createdAt: true } },
      },
    });
    const asOf = today();
    const item = this.listItem(cl);
    const scoreDetail = await this.score.evaluate(id, asOf);
    const creditLock = creditLockFor(cl, scoreDetail);
    const loans = cl.loans.map((l) => loanSummary(l, asOf)).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    const activeLoans = loans.filter((l) => l.status === 'ATIVO');

    let fidelity = null;
    if (cl.classificacao === 'BOM') {
      const limitBase = cn(cl.creditLimit) ?? Math.max(0, ...loans.map((l) => l.principalCents));
      const target = activeLoans.sort((a, b) => b.ratePercent - a.ratePercent)[0];
      const first = loans.map((l) => l.releaseDate).sort()[0];
      const months = first ? Math.max(0, Math.floor(diffDays(asOf, first) / 30)) : 0;
      const late = scoreDetail.late1to7 + scoreDetail.late8to30 + scoreDetail.lateOver30;
      fidelity = {
        limit: suggestLimitIncrease(limitBase),
        discount: target ? { loanId: target.id, ...suggestRateDiscount(target.ratePercent, target.saldoDevedorCents) } : null,
        summary: `Cliente bom há ${months} ${months === 1 ? 'mês' : 'meses'}, ${scoreDetail.onTime} parcelas pagas em dia, ${late} atrasos`,
      };
    }
    const relationLabel = RELATIONS.find((r) => r.value === cl.emergencyRelation)?.label ?? cl.emergencyRelation;
    const strategies =
      cl.classificacao === 'RUIM' || cl.classificacao === 'PERDA'
        ? collectionStrategies(
            cl.classificacao,
            scoreDetail.openDebtCents,
            {
              emergencyName: cl.emergencyName,
              emergencyRelation: relationLabel,
              emergencyPhone: cl.emergencyPhone1,
              guarantorName: cl.guarantorName,
              guarantorPhone: cl.guarantorPhone,
              address: [cl.street, cl.number].filter(Boolean).join(' ') + (cl.district ? `, ${cl.district}` : ''),
              reference: cl.reference,
              residenceTime: RESIDENCE_TIMES.find((r) => r.value === cl.residenceTime)?.label ?? null,
            },
            scoreDetail.diasSemPagar,
          )
        : [];
    const form = this.toForm(cl);
    return {
      ...item,
      form,
      progress: formProgress(form),
      whatsappImportedAt: cl.whatsappImportedAt?.toISOString() ?? null,
      lgpdConsentAt: cl.lgpdConsentAt?.toISOString() ?? null,
      scoreDetail,
      creditLock,
      fidelity,
      strategies,
      loans,
      history: cl.history.map((h) => ({ id: h.id, type: h.type, message: h.message, createdAt: h.createdAt.toISOString(), userName: h.user?.name ?? null })),
      collectionAttempts: cl.collectionAttempts.map((a) => ({ id: a.id, date: a.date.toISOString(), type: a.type, result: a.result, userName: a.user.name })),
      guarantorClient: cl.guarantorClient,
      referrerClient: cl.referrerClient ? { id: cl.referrerClient.id, fullName: cl.referrerClient.fullName, since: cl.referrerClient.createdAt.toISOString() } : null,
    };
  }

  // -------------------------------------------------------------------------
  // Criação / edição
  // -------------------------------------------------------------------------

  private validate(form: Partial<ClientForm>, draft: boolean, isUpdate: boolean) {
    // Na edição o CPF vem mascarado: só valida se veio completo
    const toCheck = { ...form };
    if (isUpdate && form.cpf && onlyDigits(form.cpf).length !== 11) delete toCheck.cpf;
    if (isUpdate && form.guarantorCpf && onlyDigits(form.guarantorCpf).length !== 11) delete toCheck.guarantorCpf;
    const issues = validateClientForm(toCheck, { draft });
    const filtered = isUpdate ? issues.filter((i) => !(i.message.includes('obrigatório') && (i.key === 'cpf' || i.key === 'guarantorCpf'))) : issues;
    if (filtered.length) throw new BadRequestException({ message: filtered.map((i) => i.message).join('; '), code: 'VALIDATION', issues: filtered });
  }

  async create(u: AuthUser, form: ClientForm, draft: boolean) {
    this.validate(form, draft, false);
    const data = this.formToData(form) as Prisma.ClientUncheckedCreateInput;
    data.status = draft ? 'RASCUNHO' : 'ATIVO';
    if (!isAdmin(u) || !data.responsibleUserId) data.responsibleUserId = isAdmin(u) ? (data.responsibleUserId ?? u.id) : u.id;
    const cl = await this.prisma.client.create({ data });
    await this.audit.log(u.id, 'CREATE', 'Client', cl.id, { source: cl.source, draft });
    return this.detail(u, cl.id);
  }

  async update(u: AuthUser, id: string, form: Partial<ClientForm>, draft: boolean) {
    await this.assertAccess(u, id);
    const current = await this.prisma.client.findUniqueOrThrow({ where: { id } });
    // Para validar "completo" usamos a ficha atual + alterações
    const merged = { ...this.toForm(current), ...form };
    this.validate(merged, draft, true);
    const data = this.formToData(form) as Prisma.ClientUncheckedUpdateInput;
    if (!isAdmin(u)) delete data.responsibleUserId;
    data.status = draft ? (current.status === 'ATIVO' ? 'ATIVO' : 'RASCUNHO') : 'ATIVO';
    await this.prisma.client.update({ where: { id }, data });
    await this.audit.log(u.id, 'UPDATE', 'Client', id, { fields: Object.keys(form) });
    return this.detail(u, id);
  }

  async revealCpf(u: AuthUser, id: string, ip?: string) {
    await this.assertAccess(u, id);
    const cl = await this.prisma.client.findUniqueOrThrow({ where: { id } });
    await this.audit.log(u.id, 'REVEAL_CPF', 'Client', id, { ip });
    return {
      cpf: cl.cpfEncrypted ? formatCPF(this.crypto.decrypt(cl.cpfEncrypted)) : null,
      guarantorCpf: cl.guarantorCpfEncrypted ? formatCPF(this.crypto.decrypt(cl.guarantorCpfEncrypted)) : null,
    };
  }

  async unblock(u: AuthUser, id: string, password: string, reason: string) {
    if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Só o Super Admin pode desbloquear');
    await this.users.verifyPassword(u.id, password);
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Informe o motivo do desbloqueio (mín. 5 caracteres)');
    await this.prisma.$transaction([
      this.prisma.client.update({ where: { id }, data: { isBlocked: false, blockedReason: null, unblockedAt: new Date(), unblockedById: u.id } }),
      this.prisma.clientHistory.create({ data: { clientId: id, userId: u.id, type: 'DESBLOQUEIO', message: `Desbloqueado por ${u.name}: ${reason.trim()}` } }),
    ]);
    await this.audit.log(u.id, 'UNBLOCK', 'Client', id, { reason });
    return this.detail(u, id);
  }

  async fidelity(u: AuthUser, id: string, body: { kind: 'DISCOUNT'; loanId: string; newRatePercent: number } | { kind: 'LIMIT'; newLimitCents: number }) {
    await this.assertAccess(u, id);
    if (!isAdmin(u)) throw new ForbiddenException('Apenas administradores aplicam condições de fidelidade');
    const cl = await this.prisma.client.findUniqueOrThrow({ where: { id } });
    if (cl.classificacao !== 'BOM') throw new BadRequestException('Condições de fidelidade são exclusivas para clientes BOM');
    const when = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (body.kind === 'DISCOUNT') {
      const loan = await this.prisma.loan.findFirst({ where: { id: body.loanId, clientId: id, status: 'ATIVO' }, include: { installments: true } });
      if (!loan) throw new NotFoundException('Empréstimo ativo não encontrado');
      const from = num(loan.interestRate);
      if (!(body.newRatePercent >= 0 && body.newRatePercent < from)) throw new BadRequestException('Nova taxa deve ser menor que a atual');
      const saldo = c(loan.saldoDevedor);
      const open = loan.installments.filter((i) => i.status === 'PENDENTE').sort((a, b) => a.number - b.number);
      // Recalcula as parcelas em aberto com a nova taxa (mesmas regras do motor)
      const rows =
        loan.type === 'INTEREST_ONLY'
          ? open.map((i) => ({ principal: c(i.principalValue), interest: pct(saldo, body.newRatePercent) }))
          : priceSchedule(saldo, body.newRatePercent, open.length);
      await this.prisma.$transaction([
        this.prisma.loan.update({ where: { id: loan.id }, data: { interestRate: body.newRatePercent, version: { increment: 1 } } }),
        ...open.map((i, idx) =>
          this.prisma.installment.update({
            where: { id: i.id },
            data: {
              principalValue: d(rows[idx].principal),
              interestValue: d(rows[idx].interest),
              originalValue: d(rows[idx].principal + rows[idx].interest),
              updatedValue: d(rows[idx].principal + rows[idx].interest),
            },
          }),
        ),
        this.prisma.clientHistory.create({
          data: { clientId: id, userId: u.id, type: 'DESCONTO_FIDELIDADE', message: `Desconto fidelidade aplicado por ${u.name} em ${when}: ${from}% -> ${body.newRatePercent}% (empréstimo #${loan.code})` },
        }),
      ]);
    } else {
      const from = cn(cl.creditLimit) ?? 0;
      await this.prisma.$transaction([
        this.prisma.client.update({ where: { id }, data: { creditLimit: d(body.newLimitCents) } }),
        this.prisma.clientHistory.create({
          data: { clientId: id, userId: u.id, type: 'AUMENTO_LIMITE', message: `Limite alterado por ${u.name} em ${when}: R$ ${(from / 100).toFixed(2)} -> R$ ${(body.newLimitCents / 100).toFixed(2)}` },
        }),
      ]);
    }
    await this.audit.log(u.id, 'FIDELITY_' + body.kind, 'Client', id, body as unknown as Record<string, unknown>);
    return this.detail(u, id);
  }

  async addAttempt(u: AuthUser, id: string, type: string, result: string) {
    await this.assertAccess(u, id);
    const a = await this.prisma.collectionAttempt.create({ data: { clientId: id, userId: u.id, type, result }, include: { user: { select: { name: true } } } });
    return { id: a.id, date: a.date.toISOString(), type: a.type, result: a.result, userName: a.user.name };
  }

  validCpf(cpf: string) {
    return isValidCPF(cpf);
  }
}
