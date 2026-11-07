import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from './prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private prisma: PrismaService) {}

  async log(
    userId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    data?: Record<string, unknown>,
    tx?: Tx,
  ) {
    this.logger.log(`${action} ${entity}${entityId ? `#${entityId}` : ''} by ${userId ?? 'system'}`);
    await (tx ?? this.prisma).auditLog.create({
      data: { userId, action, entity, entityId, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }

  async notifyAdmins(title: string, message: string, data?: Record<string, unknown>, tx?: Tx) {
    await (tx ?? this.prisma).notification.create({
      data: { role: 'SUPER_ADMIN', title, message, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }
}
