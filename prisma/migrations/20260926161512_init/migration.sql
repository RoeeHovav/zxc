-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "VatMode" AS ENUM ('EXCLUSIVE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "PricingMethod" AS ENUM ('MARKUP', 'MARGIN');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('UP', 'NEAREST');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "SpoolStatus" AS ENUM ('SEALED', 'OPEN', 'EMPTY', 'DISCARDED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVED', 'CONSUMED', 'WASTE', 'FAILED_PRINT', 'ADJUSTMENT', 'RECONCILIATION', 'RETURNED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('AVAILABLE', 'PRINTING', 'MAINTENANCE', 'OFFLINE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('PRINT_ONLY', 'MODELING_AND_PRINTING', 'MODELING_ONLY', 'SCANNING_ONLY', 'SCANNING_AND_PRINTING');

-- CreateEnum
CREATE TYPE "ModelingMode" AS ENUM ('HOURLY', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'AWAITING_MODELING', 'AWAITING_APPROVAL', 'QUEUED', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'RUSH');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP', 'COURIER', 'POST', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'BIT', 'PAYBOX', 'PAYPAL', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK', 'DONE', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DesignType" AS ENUM ('MODELING', 'SCANNING', 'SCAN_TO_CAD');

-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'REVISION_REQUESTED', 'APPROVED', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('SIMPLE', 'MODERATE', 'COMPLEX', 'EXPERT');

-- CreateEnum
CREATE TYPE "TimeCategory" AS ENUM ('MODELING', 'SCANNING', 'SCAN_CLEANUP', 'REVERSE_ENGINEERING', 'REVISION', 'OTHER');

-- CreateEnum
CREATE TYPE "DesignOwnership" AS ENUM ('CUSTOMER', 'BUSINESS', 'SHARED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MATERIALS', 'EQUIPMENT', 'MAINTENANCE', 'CONSUMABLES', 'SOFTWARE', 'SHIPPING', 'UTILITIES', 'RENT', 'MARKETING', 'FEES', 'PROFESSIONAL_SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('MODEL', 'IMAGE', 'DOCUMENT', 'ARCHIVE', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "businessName" TEXT NOT NULL DEFAULT 'My 3D Print Studio',
    "legalName" TEXT,
    "businessTaxId" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Israel',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoFileId" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "locale" TEXT NOT NULL DEFAULT 'en-IL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "vatMode" "VatMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "vatRate" DECIMAL(6,4) NOT NULL DEFAULT 0.18,
    "electricityTariffPerKwh" DECIMAL(10,4) NOT NULL DEFAULT 0.64,
    "laborCostPerHour" DECIMAL(10,2) NOT NULL DEFAULT 60,
    "scannerCostPerHour" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "defaultMachineCostPerHour" DECIMAL(10,4) NOT NULL DEFAULT 4,
    "defaultSetupMinutes" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "materialWastePercent" DECIMAL(6,4) NOT NULL DEFAULT 0.05,
    "failureAllowancePercent" DECIMAL(6,4) NOT NULL DEFAULT 0.08,
    "contingencyPercent" DECIMAL(6,4) NOT NULL DEFAULT 0.03,
    "packingCostPerOrder" DECIMAL(10,2) NOT NULL DEFAULT 5,
    "transactionFeePercent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "transactionFeeFixed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "modelingRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 180,
    "scanningRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 200,
    "scanCleanupRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 150,
    "reverseEngineeringRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 220,
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 14,
    "defaultDepositPercent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "requireDepositToProduce" BOOLEAN NOT NULL DEFAULT true,
    "defaultPaymentTerms" TEXT DEFAULT 'Payment due on delivery.',
    "quoteTerms" TEXT,
    "documentFooter" TEXT,
    "maxUploadMb" INTEGER NOT NULL DEFAULT 100,
    "storageQuotaMb" INTEGER NOT NULL DEFAULT 10240,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "method" "PricingMethod" NOT NULL DEFAULT 'MARKUP',
    "markupPercent" DECIMAL(8,4) NOT NULL DEFAULT 1.0,
    "marginPercent" DECIMAL(6,4) NOT NULL DEFAULT 0.5,
    "minimumOrderCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minimumMarginPercent" DECIMAL(6,4) NOT NULL DEFAULT 0.25,
    "priceRoundingStep" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'UP',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "includeYear" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "preferredContact" "ContactMethod" NOT NULL DEFAULT 'PHONE',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'Israel',
    "taxId" TEXT,
    "vatExempt" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingPolicyId" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDensity" DECIMAL(6,3),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "materialTypeId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "productLine" TEXT,
    "colorName" TEXT NOT NULL,
    "colorHex" TEXT,
    "diameterMm" DECIMAL(4,2) NOT NULL DEFAULT 1.75,
    "densityGcm3" DECIMAL(6,3),
    "pricePerKg" DECIMAL(10,2),
    "wastePercent" DECIMAL(6,4),
    "defaultSpoolNetG" INTEGER NOT NULL DEFAULT 1000,
    "emptySpoolWeightG" INTEGER,
    "minStockG" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "supplierId" TEXT,
    "storageLocation" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spool" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT,
    "expenseId" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "landedCost" DECIMAL(10,2),
    "netWeightG" DECIMAL(10,2) NOT NULL,
    "remainingG" DECIMAL(10,2) NOT NULL,
    "remainingIsMeasured" BOOLEAN NOT NULL DEFAULT false,
    "lastWeighedAt" TIMESTAMP(3),
    "status" "SpoolStatus" NOT NULL DEFAULT 'SEALED',
    "storageLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Spool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "spoolId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantityG" DECIMAL(10,2) NOT NULL,
    "costPerKg" DECIMAL(10,4),
    "printJobId" TEXT,
    "orderItemId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReservation" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantityG" DECIMAL(10,2) NOT NULL,
    "consumedG" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT,
    "nozzleDiameterMm" DECIMAL(4,2) NOT NULL DEFAULT 0.4,
    "nozzleNotes" TEXT,
    "hasMultiMaterial" BOOLEAN NOT NULL DEFAULT false,
    "buildVolume" TEXT,
    "status" "PrinterStatus" NOT NULL DEFAULT 'AVAILABLE',
    "purchasePrice" DECIMAL(10,2),
    "purchasedAt" TIMESTAMP(3),
    "expectedLifetimeHours" INTEGER,
    "powerWatts" INTEGER,
    "maintenancePerHour" DECIMAL(10,4),
    "consumablesPerHour" DECIMAL(10,4),
    "hourlyRateOverride" DECIMAL(10,4),
    "initialPrintHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intervalPrintHours" INTEGER,
    "intervalDays" INTEGER,
    "lastDoneAt" TIMESTAMP(3),
    "lastDonePrintHours" DECIMAL(10,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "taskId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(10,2),
    "printHoursAt" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "customerId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "requestedBy" TIMESTAMP(3),
    "pricingPolicyId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "pricingContext" JSONB NOT NULL,
    "orderDiscountType" "DiscountType",
    "orderDiscountValue" DECIMAL(12,4),
    "shippingMethod" TEXT,
    "shippingCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depositPercent" DECIMAL(6,4),
    "paymentTerms" TEXT,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "pricingSummary" JSONB,
    "pricingComplete" BOOLEAN NOT NULL DEFAULT false,
    "itemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minimumAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedProfit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "approvalNote" TEXT,
    "previousId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "partName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "quantity" INTEGER NOT NULL,
    "materialId" TEXT,
    "supportMaterialId" TEXT,
    "printerId" TEXT,
    "designProjectId" TEXT,
    "colorNote" TEXT,
    "deadline" TIMESTAMP(3),
    "specialInstructions" TEXT,
    "pricingInput" JSONB NOT NULL,
    "pricingResult" JSONB,
    "unitPrice" DECIMAL(12,2),
    "lineNet" DECIMAL(12,2),
    "lineCost" DECIMAL(12,2),

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "priority" "OrderPriority" NOT NULL DEFAULT 'NORMAL',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "pricingPolicyId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "pricingContext" JSONB NOT NULL,
    "orderDiscountType" "DiscountType",
    "orderDiscountValue" DECIMAL(12,4),
    "shippingMethod" TEXT,
    "shippingCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'PICKUP',
    "deliveryAddress" TEXT,
    "depositPercent" DECIMAL(6,4),
    "paymentTerms" TEXT,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "pricingSummary" JSONB,
    "pricingComplete" BOOLEAN NOT NULL DEFAULT false,
    "itemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minimumAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedProfit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(12,2),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "deliveryNoteNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "partName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "quantity" INTEGER NOT NULL,
    "materialId" TEXT,
    "supportMaterialId" TEXT,
    "printerId" TEXT,
    "designProjectId" TEXT,
    "colorNote" TEXT,
    "deadline" TIMESTAMP(3),
    "specialInstructions" TEXT,
    "pricingInput" JSONB NOT NULL,
    "pricingResult" JSONB,
    "unitPrice" DECIMAL(12,2),
    "lineNet" DECIMAL(12,2),
    "lineCost" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "quantityCompleted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isDeposit" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "printerId" TEXT,
    "materialId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "plannedStart" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimatedMinutes" DECIMAL(10,2),
    "actualMinutes" DECIMAL(10,2),
    "estimatedGrams" DECIMAL(10,2),
    "actualGrams" DECIMAL(10,2),
    "failureReason" TEXT,
    "reprintOfId" TEXT,
    "qcNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantityGood" INTEGER,

    CONSTRAINT "PrintJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignProject" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "DesignType" NOT NULL DEFAULT 'MODELING',
    "status" "DesignStatus" NOT NULL DEFAULT 'REQUESTED',
    "complexity" "Complexity" NOT NULL DEFAULT 'MODERATE',
    "estimatedHours" DECIMAL(8,2),
    "includedRevisions" INTEGER NOT NULL DEFAULT 2,
    "feeMode" "ModelingMode" NOT NULL DEFAULT 'HOURLY',
    "fixedFee" DECIMAL(12,2),
    "hourlyRate" DECIMAL(10,2),
    "additionalRevisionFee" DECIMAL(12,2),
    "ownership" "DesignOwnership" NOT NULL DEFAULT 'CUSTOMER',
    "licenseNotes" TEXT,
    "dueDate" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "defaultMaterialId" TEXT,
    "defaultPrinterId" TEXT,
    "defaultGramsPerUnit" DECIMAL(10,2),
    "defaultSupportGrams" DECIMAL(10,2),
    "defaultPrintMinutes" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignTimeEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" "TimeCategory" NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isChargeable" BOOLEAN NOT NULL DEFAULT false,
    "charge" DECIMAL(12,2),
    "billedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DesignRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod",
    "reference" TEXT,
    "printerId" TEXT,
    "orderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAttachment" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "purpose" TEXT,
    "customerId" TEXT,
    "quoteId" TEXT,
    "quoteItemId" TEXT,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "designProjectId" TEXT,
    "printJobId" TEXT,
    "expenseId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MaterialTypeToPrinter" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MaterialTypeToPrinter_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPolicy_name_key" ON "PricingPolicy"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_number_key" ON "Customer"("number");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_emailNormalized_idx" ON "Customer"("emailNormalized");

-- CreateIndex
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialType_code_key" ON "MaterialType"("code");

-- CreateIndex
CREATE INDEX "Material_materialTypeId_idx" ON "Material"("materialTypeId");

-- CreateIndex
CREATE INDEX "Material_isActive_idx" ON "Material"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Spool_code_key" ON "Spool"("code");

-- CreateIndex
CREATE INDEX "Spool_materialId_status_idx" ON "Spool"("materialId", "status");

-- CreateIndex
CREATE INDEX "StockMovement_materialId_createdAt_idx" ON "StockMovement"("materialId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_spoolId_idx" ON "StockMovement"("spoolId");

-- CreateIndex
CREATE INDEX "StockMovement_printJobId_idx" ON "StockMovement"("printJobId");

-- CreateIndex
CREATE INDEX "StockMovement_orderItemId_idx" ON "StockMovement"("orderItemId");

-- CreateIndex
CREATE INDEX "MaterialReservation_materialId_status_idx" ON "MaterialReservation"("materialId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReservation_orderItemId_materialId_key" ON "MaterialReservation"("orderItemId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_name_key" ON "Printer"("name");

-- CreateIndex
CREATE INDEX "Printer_status_idx" ON "Printer"("status");

-- CreateIndex
CREATE INDEX "MaintenanceTask_printerId_idx" ON "MaintenanceTask"("printerId");

-- CreateIndex
CREATE INDEX "MaintenanceLog_printerId_performedAt_idx" ON "MaintenanceLog"("printerId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_previousId_key" ON "Quote"("previousId");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_createdAt_idx" ON "Quote"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_revision_key" ON "Quote"("number", "revision");

-- CreateIndex
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_deliveryNoteNumber_key" ON "Order"("deliveryNoteNumber");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_dueDate_idx" ON "Order"("dueDate");

-- CreateIndex
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_materialId_idx" ON "OrderItem"("materialId");

-- CreateIndex
CREATE INDEX "OrderItem_designProjectId_idx" ON "OrderItem"("designProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_number_key" ON "Payment"("number");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_number_key" ON "PrintJob"("number");

-- CreateIndex
CREATE INDEX "PrintJob_orderId_idx" ON "PrintJob"("orderId");

-- CreateIndex
CREATE INDEX "PrintJob_printerId_status_idx" ON "PrintJob"("printerId", "status");

-- CreateIndex
CREATE INDEX "PrintJob_status_idx" ON "PrintJob"("status");

-- CreateIndex
CREATE INDEX "PrintJobItem_orderItemId_idx" ON "PrintJobItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJobItem_jobId_orderItemId_key" ON "PrintJobItem"("jobId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignProject_number_key" ON "DesignProject"("number");

-- CreateIndex
CREATE INDEX "DesignProject_customerId_idx" ON "DesignProject"("customerId");

-- CreateIndex
CREATE INDEX "DesignProject_status_idx" ON "DesignProject"("status");

-- CreateIndex
CREATE INDEX "DesignTimeEntry_projectId_idx" ON "DesignTimeEntry"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignRevision_projectId_number_key" ON "DesignRevision"("projectId", "number");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE UNIQUE INDEX "FileAttachment_storageKey_key" ON "FileAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "FileAttachment_customerId_idx" ON "FileAttachment"("customerId");

-- CreateIndex
CREATE INDEX "FileAttachment_orderId_idx" ON "FileAttachment"("orderId");

-- CreateIndex
CREATE INDEX "FileAttachment_quoteId_idx" ON "FileAttachment"("quoteId");

-- CreateIndex
CREATE INDEX "FileAttachment_designProjectId_idx" ON "FileAttachment"("designProjectId");

-- CreateIndex
CREATE INDEX "_MaterialTypeToPrinter_B_index" ON "_MaterialTypeToPrinter"("B");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pricingPolicyId_fkey" FOREIGN KEY ("pricingPolicyId") REFERENCES "PricingPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spool" ADD CONSTRAINT "Spool_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spool" ADD CONSTRAINT "Spool_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spool" ADD CONSTRAINT "Spool_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_spoolId_fkey" FOREIGN KEY ("spoolId") REFERENCES "Spool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_pricingPolicyId_fkey" FOREIGN KEY ("pricingPolicyId") REFERENCES "PricingPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_supportMaterialId_fkey" FOREIGN KEY ("supportMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_designProjectId_fkey" FOREIGN KEY ("designProjectId") REFERENCES "DesignProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pricingPolicyId_fkey" FOREIGN KEY ("pricingPolicyId") REFERENCES "PricingPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_supportMaterialId_fkey" FOREIGN KEY ("supportMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_designProjectId_fkey" FOREIGN KEY ("designProjectId") REFERENCES "DesignProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_reprintOfId_fkey" FOREIGN KEY ("reprintOfId") REFERENCES "PrintJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJobItem" ADD CONSTRAINT "PrintJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJobItem" ADD CONSTRAINT "PrintJobItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignProject" ADD CONSTRAINT "DesignProject_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignProject" ADD CONSTRAINT "DesignProject_defaultMaterialId_fkey" FOREIGN KEY ("defaultMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignProject" ADD CONSTRAINT "DesignProject_defaultPrinterId_fkey" FOREIGN KEY ("defaultPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignTimeEntry" ADD CONSTRAINT "DesignTimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "QuoteItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_designProjectId_fkey" FOREIGN KEY ("designProjectId") REFERENCES "DesignProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialTypeToPrinter" ADD CONSTRAINT "_MaterialTypeToPrinter_A_fkey" FOREIGN KEY ("A") REFERENCES "MaterialType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialTypeToPrinter" ADD CONSTRAINT "_MaterialTypeToPrinter_B_fkey" FOREIGN KEY ("B") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
