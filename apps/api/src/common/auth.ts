import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const isAdmin = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN';

/** Guard global: JWT obrigatório (exceto @Public) + checagem de @Roles. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Faça login para continuar');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: Role; name: string }>(token);
      req.user = { id: payload.sub, role: payload.role, name: payload.name } satisfies AuthUser;
    } catch {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente');
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Sem permissão para esta ação');
    return true;
  }
}
