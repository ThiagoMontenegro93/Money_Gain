import { Body, Controller, ForbiddenException, Get, Injectable, Logger, OnApplicationBootstrap, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
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

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      await this.audit.log(user?.id ?? null, 'LOGIN_FAILED', 'User', user?.id ?? null, { email });
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, name: user.name });
    return { accessToken, user: toUserDTO(user) };
  }

  /** Reconfirmação de senha para ações sensíveis (aprovação, desbloqueio, restauração). */
  async verifyPassword(userId: string, password: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!password || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException({ message: 'Senha incorreta', code: 'BAD_PASSWORD' });
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
  @Post('auth/login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.users.login(body.email, body.password);
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
