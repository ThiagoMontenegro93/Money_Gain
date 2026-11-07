-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU', 'LINK_GERADO', 'BLOQUEADO', 'CANCELADO');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "negativadoEm" TIMESTAMP(3),
ADD COLUMN     "negativadoPorId" TEXT,
ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ClientReceipt" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "checkedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pixKey" TEXT;

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "loanId" TEXT,
    "installmentId" TEXT,
    "paymentId" TEXT,
    "template" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "toName" TEXT,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerId" TEXT,
    "waLink" TEXT,
    "dedupeKey" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_dedupeKey_key" ON "MessageLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "MessageLog_status_scheduledFor_idx" ON "MessageLog"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MessageLog_clientId_createdAt_idx" ON "MessageLog"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
