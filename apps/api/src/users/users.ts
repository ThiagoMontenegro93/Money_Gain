import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Injectable, Ip, Logger, OnApplicationBootstrap, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, isAdmin, Public, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { c, num, ZodPipe } from '../common/util';

export function toUserDTO(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    pixKey: u.pixKey,
    role: u.role,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    failedLogins: u.failedLogins,
    commissionPercent: num(u.commissionPercent),
    revolving: u.revolving,
    wallet: {
      capitalDisponivelCents: c(u.capitalDisponivel),
      capitalEmprestadoCents: c(u.capitalEmprestado),
      comissaoAPagarCents: c(u.comissaoAPagar),
      paraRepassarCents: c(u.paraRepassar),
      recebidoClientesCents: c(u.recebidoClientes),
    },
  };
}

/** Bloqueio por senha errada: 5 erros seguidos bloqueiam 15 min; cada erro a mais dobra (até 24 h). */
export const LOGIN_MAX_FAILS = 5;
const LOCK_BASE_MS = 15 * 60_000;
const LOCK_MAX_MS = 24 * 60 * 60_000;
export const lockMsFor = (fails: number) => (fails < LOGIN_MAX_FAILS ? 0 : Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (fails - LOGIN_MAX_FAILS)));
/** Limite por IP (inclui e-mails que não existem): 20 erros em 15 min. */
const IP_MAX_FAILS = 20;
const IP_WINDOW_MS = 15 * 60_000;

function lockedMessage(until: Date) {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  const quando = min >= 60 ? `${Math.ceil(min / 60)} h` : `${min} min`;
  return `Acesso bloqueado por muitas senhas erradas. Tente de novo em ${quando} ou peça ao dono para desbloquear.`;
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  /** Primeiro acesso em produção: banco vazio + OWNER_EMAIL/OWNER_PASSWORD definidos -> cria o dono (Super Admin). */
  async onApplicationBootstrap() {
    const email = process.env.OWNER_EMAIL?.toLowerCase().trim();
    const password = process.env.OWNER_PASSWORD;
    if (!email || !password) return;
    if (await this.prisma.user.count()) return;
    if (password.length < 8) throw new Error('OWNER_PASSWORD deve ter ao menos 8 caracteres');
    const u = await this.prisma.user.create({
      data: { name: process.env.OWNER_NAME || 'Dono', email, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 10), revolving: false },
    });
    await this.audit.log(u.id, 'CREATE', 'User', u.id, { role: 'SUPER_ADMIN', bootstrap: true });
    new Logger('Users').log(`Dono criado no primeiro acesso: ${email} (troque a senha em Configurações)`);
  }

  private ipFails = new Map<string, { count: number; resetAt: number }>();

  private checkIp(ip: string) {
    const e = this.ipFails.get(ip);
    if (e && e.resetAt > Date.now() && e.count >= IP_MAX_FAILS)
      throw new HttpException({ message: 'Muitas tentativas deste aparelho. Espere 15 minutos e tente de novo.', code: 'TOO_MANY_ATTEMPTS' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private countIp(ip: string) {
    // o próprio servidor (testes, scripts locais) não conta; em produção o IP vem do proxy
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return;
    const now = Date.now();
    const e = this.ipFails.get(ip);
    if (!e || e.resetAt <= now) this.ipFails.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    else e.count++;
    if (this.ipFails.size > 10_000) for (const [k, v] of this.ipFails) if (v.resetAt <= now) this.ipFails.delete(k);
  }

  /** Registra uma senha errada; no limite, bloqueia e avisa o dono. Devolve a data do bloqueio, se houver. */
  private async registerFailure(user: User, origin: 'login' | 'confirmação') {
    const fails = user.failedLogins + 1;
    const ms = lockMsFor(fails);
    const lockedUntil = ms ? new Date(Date.now() + ms) : null;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: fails, ...(lockedUntil ? { lockedUntil } : {}) } });
    if (lockedUntil && fails === LOGIN_MAX_FAILS) {
      await this.audit.log(user.id, 'ACCOUNT_LOCKED', 'User', user.id, { fails, until: lockedUntil.toISOString(), origin });
      await this.audit.notifyAdmins('Acesso bloqueado', `${user.name} (${user.email}) errou a senha ${fails} vezes seguidas (${origin}). Acesso bloqueado até ${lockedUntil.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, { userId: user.id });
    }
    return lockedUntil;
  }

  async login(email: string, password: string, ip = 'desconhecido') {
    this.checkIp(ip);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      this.countIp(ip);
      await this.audit.log(user.id, 'LOGIN_BLOCKED', 'User', user.id, { email, ip });
      throw new HttpException({ message: lockedMessage(user.lockedUntil), code: 'ACCOUNT_LOCKED' }, HttpStatus.LOCKED);
    }
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      this.countIp(ip);
      await this.audit.log(user?.id ?? null, 'LOGIN_FAILED', 'User', user?.id ?? null, { email, ip });
      if (user && user.isActive) {
        const until = await this.registerFailure(user, 'login');
        if (until) throw new HttpException({ message: lockedMessage(until), code: 'ACCOUNT_LOCKED' }, HttpStatus.LOCKED);
        const left = LOGIN_MAX_FAILS - (user.failedLogins + 1);
        if (left <= 2) throw new UnauthorizedException({ message: `E-mail ou senha inválidos. Mais ${left} tentativa(s) antes de bloquear o acesso.`, code: 'BAD_LOGIN' });
      }
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    if (user.failedLogins || user.lockedUntil) await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log(user.id, 'LOGIN', 'User', user.id, { ip });
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, name: user.name });
    return { accessToken, user: toUserDTO(user) };
  }

  /** Reconfirmação de senha para ações sensíveis (aprovação, desbloqueio, restauração). */
  async verifyPassword(userId: string, password: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new HttpException({ message: lockedMessage(user.lockedUntil), code: 'ACCOUNT_LOCKED' }, HttpStatus.LOCKED);
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      const until = await this.registerFailure(user, 'confirmação');
      if (until) throw new HttpException({ message: lockedMessage(until), code: 'ACCOUNT_LOCKED' }, HttpStatus.LOCKED);
      throw new UnauthorizedException({ message: 'Senha incorreta', code: 'BAD_PASSWORD' });
    }
    if (user.failedLogins) await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0 } });
    return user;
  }

  async get(id: string) {
    return toUserDTO(await this.prisma.user.findUniqueOrThrow({ where: { id } }));
  }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres'),
  role: z.nativeEnum(Role),
  phone: z.string().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  revolving: z.boolean().optional(),
});

const selfSchema = z.object({
  phone: z.string().max(30).nullable().optional(),
  pixKey: z.string().max(120).nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Nova senha deve ter ao menos 8 caracteres').optional(),
});
const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().max(30).nullable().optional(),
  pixKey: z.string().max(120).nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  revolving: z.boolean().optional(),
});

@Controller()
export class UsersController {
  constructor(
    private users: UsersService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('auth/login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Ip() ip: string) {
    return this.users.login(body.email, body.password, ip);
  }

  /** Dono desbloqueia o acesso de alguém que errou a senha várias vezes. */
  @Roles('SUPER_ADMIN')
  @Post('users/:id/unlock')
  async unlock(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const user = await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log(u.id, 'UNLOCK', 'User', id);
    return toUserDTO(user);
  }

  @Get('auth/me')
  me(@CurrentUser() u: AuthUser) {
    return this.users.get(u.id);
  }

  @Get('users')
  async list(@CurrentUser() u: AuthUser) {
    const where = isAdmin(u) ? {} : { id: u.id };
    return (await this.prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { name: 'asc' }] })).map(toUserDTO);
  }

  @Put('users/me')
  async updateMe(@CurrentUser() u: AuthUser, @Body(new ZodPipe(selfSchema)) b: z.infer<typeof selfSchema>) {
    const data: Record<string, unknown> = { ...(b.phone !== undefined ? { phone: b.phone } : {}), ...(b.pixKey !== undefined ? { pixKey: b.pixKey } : {}) };
    if (b.newPassword) {
      await this.users.verifyPassword(u.id, b.currentPassword);
      data.passwordHash = await bcrypt.hash(b.newPassword, 10);
    }
    const user = await this.prisma.user.update({ where: { id: u.id }, data });
    await this.audit.log(u.id, 'UPDATE_SELF', 'User', u.id, { fields: Object.keys(data).filter((k) => k !== 'passwordHash') });
    return toUserDTO(user);
  }

  @Roles('SUPER_ADMIN')
  @Put('users/:id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateUserSchema)) b: z.infer<typeof updateUserSchema>) {
    if (id === u.id && (b.isActive === false || (b.role && b.role !== 'SUPER_ADMIN'))) throw new ForbiddenException('Você não pode desativar ou rebaixar a si mesmo');
    const user = await this.prisma.user.update({ where: { id }, data: b });
    await this.audit.log(u.id, 'UPDATE', 'User', id, b);
    return toUserDTO(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('users')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createUserSchema)) b: z.infer<typeof createUserSchema>) {
    const user = await this.prisma.user.create({
      data: {
        name: b.name,
        email: b.email.toLowerCase().trim(),
        phone: b.phone,
        role: b.role,
        passwordHash: await bcrypt.hash(b.password, 10),
        commissionPercent: b.commissionPercent ?? 30,
        revolving: b.revolving ?? true,
      },
    });
    await this.audit.log(u.id, 'CREATE', 'User', user.id, { role: b.role });
    return toUserDTO(user);
  }
}
