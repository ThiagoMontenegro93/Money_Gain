-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "allowAmortization" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowLateFee" BOOLEAN NOT NULL DEFAULT true;
