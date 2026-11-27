-- CreateEnum
CREATE TYPE "LongLateMode" AS ENUM ('OFF', 'PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "longLateAfterDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "longLateFixed" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "longLateMode" "LongLateMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "longLatePercent" DECIMAL(9,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "longLatePart" DECIMAL(14,2);
