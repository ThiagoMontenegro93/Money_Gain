import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, Logger, NestInterceptor, UnprocessableEntityException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { AuthUser } from './auth';
import { PrismaService } from './prisma.service';

/** Retenção das chaves (limpeza na rotina diária). */
export const IDEMPOTENCY_RETENTION_DAYS = 7;
/** Uma requisição "em processamento" mais antiga que isso é considerada abandonada (queda no meio). */
const STALE_MS = 60_000;
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Fase 4 (offline-first): suporte ao cabeçalho opcional `Idempotency-Key` nos POSTs que a fila
 * do aparelho reenvia (recibo, cliente, tentativa de cobrança, comprovante, upload).
 *
 * - Sem cabeçalho: comportamento normal.
 * - Primeira vez (usuário + chave): executa e guarda status + corpo da resposta de sucesso.
 * - Repetição com a mesma chave: devolve a resposta original (cabeçalho `Idempotent-Replayed: true`)
 *   sem executar de novo, então reenvios após queda de rede não duplicam registros.
 * - Erros (4xx/5xx) não são guardados: a chave é liberada para nova tentativa.
 * - Escopo por usuário: a chave de um usuário nunca devolve o resultado de outro.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');
  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<{ headers: Record<string, string | string[] | undefined>; method: string; originalUrl?: string; url: string; user?: AuthUser }>();
    const res = http.getResponse<{ status: (n: number) => unknown; setHeader: (k: string, v: string) => void }>();
    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !req.user) return next.handle();
    if (!KEY_RE.test(key)) throw new BadRequestException({ message: 'Idempotency-Key inválida (8 a 128 caracteres: letras, números, - _ . :)', code: 'IDEMPOTENCY_KEY_INVALID' });
    const userId = req.user.id;
    const method = req.method.toUpperCase();
    const path = (req.originalUrl ?? req.url).split('?')[0];
    // status que o Nest aplicará após o handler (@HttpCode ou 201 para POST)
    const statusCode: number = Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler()) ?? (method === 'POST' ? 201 : 200);

    return from(this.begin(userId, key, method, path)).pipe(
      mergeMap((state) => {
        if (state.kind === 'replay') {
          res.status(state.statusCode);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(state.response);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.finish(state.id, statusCode, body))),
          catchError((err) => from(this.release(state.id)).pipe(mergeMap(() => { throw err; }))),
        );
      }),
    );
  }

  private async begin(userId: string, key: string, method: string, path: string): Promise<{ kind: 'run'; id: string } | { kind: 'replay'; statusCode: number; response: unknown }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const found = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (found) {
        if (found.method !== method || found.path !== path) {
          throw new UnprocessableEntityException({ message: 'Esta Idempotency-Key já foi usada em outra operação', code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        if (found.statusCode != null) return { kind: 'replay', statusCode: found.statusCode, response: found.response ?? null };
        if (Date.now() - found.createdAt.getTime() < STALE_MS) {
          throw new ConflictException({ message: 'Esta operação ainda está sendo processada. Tente novamente em instantes.', code: 'IDEMPOTENCY_IN_PROGRESS' });
        }
        await this.prisma.idempotencyKey.deleteMany({ where: { id: found.id, statusCode: null } });
      }
      try {
        const row = await this.prisma.idempotencyKey.create({ data: { userId, key, method, path } });
        return { kind: 'run', id: row.id };
      } catch (e) {
        // corrida: outra requisição com a mesma chave chegou junto - relê
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new ConflictException({ message: 'Esta operação ainda está sendo processada. Tente novamente em instantes.', code: 'IDEMPOTENCY_IN_PROGRESS' });
  }

  private async finish(id: string, statusCode: number, body: unknown) {
    const response = body === undefined ? null : (JSON.parse(JSON.stringify(body)) as unknown);
    try {
      await this.prisma.idempotencyKey.update({
        where: { id },
        data: { statusCode, response: response === null ? Prisma.JsonNull : (response as Prisma.InputJsonValue), completedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`Falha ao gravar resposta idempotente: ${(e as Error).message}`);
    }
    return body;
  }

  private async release(id: string) {
    await this.prisma.idempotencyKey.deleteMany({ where: { id } }).catch(() => undefined);
  }
}
