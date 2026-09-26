-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "clientKey" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientKey_key" ON "Order"("clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientKey_key" ON "Payment"("clientKey");

