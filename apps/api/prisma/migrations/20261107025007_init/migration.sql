-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ClientScore" AS ENUM ('BOM', 'REGULAR', 'RUIM', 'PERDA');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('RASCUNHO', 'ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "ClientSource" AS ENUM ('MANUAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "LoanMethod" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('INTEREST_ONLY', 'FIXED_INSTALLMENT');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ATIVO', 'QUITADO', 'PERDA', 'CANCELADO');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDENTE', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "InstallmentType" AS ENUM ('QUITACAO_PREVISTA', 'PROJECAO_JUROS', 'PARCELA_FIXA');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('JUROS', 'QUITACAO', 'AMORTIZACAO', 'PARCELA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AGUARDANDO_APROVACAO', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('REPASSE_CAPITAL', 'REPASSE_LUCRO', 'DEVOLUCAO_CAPITAL', 'PAGAMENTO_COMISSAO');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('AGUARDANDO_APROVACAO', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('APORTE_CAPITAL', 'SAIDA_EMPRESTIMO', 'ENTRADA_PRINCIPAL', 'ENTRADA_JUROS', 'ENTRADA_MULTA', 'COMISSAO', 'REPASSE_CAPITAL', 'REPASSE_LUCRO', 'DEVOLUCAO_CAPITAL', 'PAGAMENTO_COMISSAO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RG', 'CPF', 'COMPROVANTE_RESIDENCIA', 'COMPROVANTE_RENDA', 'SELFIE', 'CONTRATO', 'FIADOR_FOTO', 'COMPROVANTE_PAGAMENTO_CLIENTE');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDENTE_CONFERENCIA', 'CONFERIDO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "revolving" BOOLEAN NOT NULL DEFAULT true,
    "capitalDisponivel" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "capitalEmprestado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "comissaoAPagar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paraRepassar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recebidoClientes" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ATIVO',
    "source" "ClientSource" NOT NULL DEFAULT 'MANUAL',
    "whatsappImportedAt" TIMESTAMP(3),
    "responsibleUserId" TEXT,
    "fullName" TEXT NOT NULL,
    "cpfEncrypted" TEXT,
    "cpfHash" TEXT,
    "cpfLast" TEXT,
    "rg" TEXT,
    "rgIssuer" TEXT,
    "birthDate" DATE,
    "selfieFileId" TEXT,
    "notes" TEXT,
    "whatsapp" TEXT,
    "whatsapp2" TEXT,
    "cep" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "reference" TEXT,
    "residenceTime" TEXT,
    "pixKey" TEXT,
    "pixType" TEXT,
    "profession" TEXT,
    "income" DECIMAL(14,2),
    "workplace" TEXT,
    "internalScore" INTEGER,
    "creditLimit" DECIMAL(14,2),
    "emergencyName" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPhone1" TEXT,
    "emergencyPhone2" TEXT,
    "hasGuarantor" BOOLEAN NOT NULL DEFAULT false,
    "guarantorName" TEXT,
    "guarantorCpfEncrypted" TEXT,
    "guarantorCpfLast" TEXT,
    "guarantorPhone" TEXT,
    "guarantorRelation" TEXT,
    "guarantorClientId" TEXT,
    "guarantorDocFileId" TEXT,
    "referrerName" TEXT,
    "referrerPhone" TEXT,
    "referrerClientId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 5,
    "classificacao" "ClientScore" NOT NULL DEFAULT 'REGULAR',
    "pontualidade" DECIMAL(5,4),
    "diasSemPagar" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentAt" DATE,
    "scoreUpdatedAt" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "unblockedAt" TIMESTAMP(3),
    "unblockedById" TEXT,
    "lgpdConsentAt" TIMESTAMP(3),
    "lgpdConsentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "funderUserId" TEXT NOT NULL,
    "lenderUserId" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(9,4) NOT NULL,
    "multaDiaPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "method" "LoanMethod" NOT NULL,
    "type" "LoanType" NOT NULL,
    "installmentsCount" INTEGER,
    "releaseDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ATIVO',
    "saldoDevedor" DECIMAL(14,2) NOT NULL,
    "isProjection" BOOLEAN NOT NULL DEFAULT false,
    "parentLoanId" TEXT,
    "riskAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "quitadoEm" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalValue" DECIMAL(14,2) NOT NULL,
    "interestValue" DECIMAL(14,2) NOT NULL,
    "originalValue" DECIMAL(14,2) NOT NULL,
    "updatedValue" DECIMAL(14,2) NOT NULL,
    "multaDiaPercent" DECIMAL(9,4) NOT NULL,
    "diasAtraso" INTEGER NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDENTE',
    "type" "InstallmentType" NOT NULL,
    "isProjection" BOOLEAN NOT NULL DEFAULT false,
    "paidValue" DECIMAL(14,2),
    "paidAt" DATE,
    "paidKind" "PaymentType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentId" TEXT,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'AGUARDANDO_APROVACAO',
    "value" DECIMAL(14,2) NOT NULL,
    "expectedValue" DECIMAL(14,2),
    "paidAt" DATE NOT NULL,
    "comprovanteUrl" TEXT,
    "comprovanteFileId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "principalPart" DECIMAL(14,2),
    "interestPart" DECIMAL(14,2),
    "finePart" DECIMAL(14,2),
    "extraPart" DECIMAL(14,2),
    "commissionPart" DECIMAL(14,2),
    "resultMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalTransfer" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "type" "TransferType" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'AGUARDANDO_APROVACAO',
    "notes" TEXT,
    "comprovanteFileId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "loanId" TEXT,
    "paymentId" TEXT,
    "transferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentViewLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentViewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReceipt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "informedValue" DECIMAL(14,2),
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDENTE_CONFERENCIA',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAttempt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "totalClientes" INTEGER NOT NULL,
    "totalEmprestimos" INTEGER NOT NULL,
    "totalParcelas" INTEGER NOT NULL DEFAULT 0,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "isRestore" BOOLEAN NOT NULL DEFAULT false,
    "emailSentTo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_cpfHash_key" ON "Client"("cpfHash");

-- CreateIndex
CREATE INDEX "Client_classificacao_idx" ON "Client"("classificacao");

-- CreateIndex
CREATE INDEX "Client_responsibleUserId_idx" ON "Client"("responsibleUserId");

-- CreateIndex
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");

-- CreateIndex
CREATE INDEX "ClientHistory_clientId_createdAt_idx" ON "ClientHistory"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_code_key" ON "Loan"("code");

-- CreateIndex
CREATE INDEX "Loan_clientId_status_idx" ON "Loan"("clientId", "status");

-- CreateIndex
CREATE INDEX "Loan_lenderUserId_status_idx" ON "Loan"("lenderUserId", "status");

-- CreateIndex
CREATE INDEX "Installment_status_dueDate_idx" ON "Installment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_loanId_number_key" ON "Installment"("loanId", "number");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_loanId_idx" ON "Payment"("loanId");

-- CreateIndex
CREATE INDEX "CapitalTransfer_status_idx" ON "CapitalTransfer"("status");

-- CreateIndex
CREATE INDEX "CashLedger_userId_createdAt_idx" ON "CashLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "Document_clientId_type_idx" ON "Document"("clientId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_guarantorClientId_fkey" FOREIGN KEY ("guarantorClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_referrerClientId_fkey" FOREIGN KEY ("referrerClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHistory" ADD CONSTRAINT "ClientHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHistory" ADD CONSTRAINT "ClientHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_funderUserId_fkey" FOREIGN KEY ("funderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lenderUserId_fkey" FOREIGN KEY ("lenderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_parentLoanId_fkey" FOREIGN KEY ("parentLoanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalTransfer" ADD CONSTRAINT "CapitalTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalTransfer" ADD CONSTRAINT "CapitalTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalTransfer" ADD CONSTRAINT "CapitalTransfer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "CapitalTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentViewLog" ADD CONSTRAINT "DocumentViewLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentViewLog" ADD CONSTRAINT "DocumentViewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAttempt" ADD CONSTRAINT "CollectionAttempt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAttempt" ADD CONSTRAINT "CollectionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
