import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { LoanEngineError } from '@lendcontrol/core';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** Padroniza erros: { statusCode, message, code }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'Erro interno. Tente novamente.';
    let code: string | undefined;

    if (exception instanceof LoanEngineError || (exception as Error)?.name === 'LoanEngineError') {
      status = 400;
      message = (exception as LoanEngineError).message;
      code = (exception as LoanEngineError).code;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const b = body as { message?: string | string[]; code?: string };
        message = Array.isArray(b.message) ? b.message.join('; ') : (b.message ?? exception.message);
        code = b.code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        const target = String((exception.meta?.target as string[] | undefined)?.join(',') ?? '');
        message = target.includes('cpfHash') ? 'Já existe um cliente com este CPF' : 'Registro duplicado';
        code = 'DUPLICATE';
      } else if (exception.code === 'P2025') {
        status = 404;
        message = 'Registro não encontrado';
      }
    }
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json({ statusCode: status, message, code });
  }
}
