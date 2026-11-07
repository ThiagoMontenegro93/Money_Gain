import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth';
import { CryptoService } from './common/crypto.service';
import { AllExceptionsFilter } from './common/errors.filter';
import { PrismaService } from './common/prisma.service';
import { ClientsController } from './clients/clients.controller';
import { ClientsService } from './clients/clients.service';
import { ScoreService } from './clients/score.service';
import { DashboardController, DashboardService } from './dashboard/dashboard';
import { FilesController, FilesService } from './files/files';
import { JobsController, JobsService } from './jobs/jobs';
import { LoansController, LoansService } from './loans/loans';
import { PaymentsController, PaymentsService } from './payments/payments';
import { UsersController, UsersService } from './users/users';
import { WalletsController, WalletsService } from './wallets/wallets';

const jwtSecret = process.env.JWT_SECRET ?? '';
if (jwtSecret.length < 32) throw new Error('JWT_SECRET deve ter ao menos 32 caracteres');

@Module({
  imports: [
    JwtModule.register({ global: true, secret: jwtSecret, signOptions: { expiresIn: '12h' } }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    UsersController,
    ClientsController,
    LoansController,
    PaymentsController,
    WalletsController,
    FilesController,
    DashboardController,
    JobsController,
  ],
  providers: [
    PrismaService,
    CryptoService,
    AuditService,
    UsersService,
    ScoreService,
    ClientsService,
    LoansService,
    PaymentsService,
    WalletsService,
    FilesService,
    DashboardService,
    JobsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
