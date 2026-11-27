-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'PERDA_RENEGOCIACAO';

-- AlterEnum
ALTER TYPE "LoanStatus" ADD VALUE 'RENEGOCIADO';

-- CreateTable
CREATE TABLE "Renegotiation" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "oldLoanId" TEXT NOT NULL,
    "newLoanId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "debtValue" DECIMAL(14,2) NOT NULL,
    "saldoDevedor" DECIMAL(14,2) NOT NULL,
    "agreedValue" DECIMAL(14,2) NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "method" "LoanMethod" NOT NULL,
    "firstDueDate" DATE NOT NULL,
    "writeOff" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Renegotiation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Renegotiation_code_key" ON "Renegotiation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Renegotiation_oldLoanId_key" ON "Renegotiation"("oldLoanId");

-- CreateIndex
CREATE UNIQUE INDEX "Renegotiation_newLoanId_key" ON "Renegotiation"("newLoanId");

-- CreateIndex
CREATE INDEX "Renegotiation_clientId_idx" ON "Renegotiation"("clientId");

-- CreateIndex
CREATE INDEX "Renegotiation_createdAt_idx" ON "Renegotiation"("createdAt");

-- AddForeignKey
ALTER TABLE "Renegotiation" ADD CONSTRAINT "Renegotiation_oldLoanId_fkey" FOREIGN KEY ("oldLoanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Renegotiation" ADD CONSTRAINT "Renegotiation_newLoanId_fkey" FOREIGN KEY ("newLoanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Renegotiation" ADD CONSTRAINT "Renegotiation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
