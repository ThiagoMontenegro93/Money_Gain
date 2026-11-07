import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** Configurações chave/valor (JSON) persistidas no banco. */
@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) return fallback;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...(row.value as object) } as T;
    return row.value as T;
  }

  async set<T>(key: string, value: T) {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
    return value;
  }
}
