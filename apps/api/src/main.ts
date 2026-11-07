import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// Carrega .env simples (sem dependência extra) antes de qualquer módulo ler process.env
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function bootstrap() {
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('@nestjs/common');
  const helmet = (await import('helmet')).default;
  const express = (await import('express')).default;
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: false });
  app.setGlobalPrefix('api');

  // Mesma origem: se existir o build web do app, serve em "/" (seção 10: página + API de um backend)
  const webDir = process.env.WEB_DIST_DIR ? resolve(process.env.WEB_DIST_DIR) : join(__dirname, '..', '..', 'app', 'dist');
  if (existsSync(join(webDir, 'index.html'))) {
    const server = app.getHttpAdapter().getInstance();
    server.use(express.static(webDir, { index: false, maxAge: '1h' }));
    server.get(/^\/(?!api\/).*/, (_req: unknown, res: { sendFile: (p: string) => void }) => res.sendFile(join(webDir, 'index.html')));
    Logger.log(`Servindo app web de ${webDir}`, 'Bootstrap');
  }

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`LendControl API em http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((e) => {
  console.error('Falha ao iniciar a API:', e);
  process.exit(1);
});
