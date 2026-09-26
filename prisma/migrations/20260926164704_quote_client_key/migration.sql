-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_clientKey_key" ON "Quote"("clientKey");

