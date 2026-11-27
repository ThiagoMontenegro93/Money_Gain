-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "offsiteAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StoredFile_offsiteAt_idx" ON "StoredFile"("offsiteAt");
