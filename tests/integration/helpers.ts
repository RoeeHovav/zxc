import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { seedReferenceData } from "@/server/services/reference-data";
import type { LineForm, OrderForm, QuoteForm } from "@/domain/schemas/sales";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function seedBasics() {
  const user = await prisma.user.create({ data: { email: "owner@test.local", name: "Test Owner", passwordHash: await hashPassword("integration-pass-123") } });
  await prisma.settings.create({
    data: {
      id: 1,
      businessName: "Test Forge",
      vatMode: "EXCLUSIVE",
      vatRate: "0.18",
      electricityTariffPerKwh: "0.64",
      laborCostPerHour: "60",
      defaultSetupMinutes: "0",
      materialWastePercent: "0",
      failureAllowancePercent: "0",
      contingencyPercent: "0",
      packingCostPerOrder: "0",
      requireDepositToProduce: true,
      defaultDepositPercent: "0",
    },
  });
  const policy = await prisma.pricingPolicy.create({
    data: { name: "Standard", method: "MARKUP", markupPercent: "1", minimumOrderCharge: "0", minimumMarginPercent: "0.25", priceRoundingStep: "1", isDefault: true },
  });
  await prisma.$transaction((tx) => seedReferenceData(tx));
  const pla = await prisma.materialType.findUniqueOrThrow({ where: { code: "PLA" } });
  const material = await prisma.material.create({
    data: { materialTypeId: pla.id, brand: "Bambu", productLine: "PLA Basic", colorName: "Black", pricePerKg: "100", minStockG: 500, emptySpoolWeightG: 250 },
  });
  const printer = await prisma.printer.create({ data: { name: "X1C", model: "X1 Carbon", hourlyRateOverride: "5" } });
  // The customer below takes C-0001 directly, so advance the sequence past it.
  await prisma.numberSequence.create({ data: { key: "CUSTOMER", prefix: "C", nextValue: 2, padding: 4, includeYear: false } });
  const customer = await prisma.customer.create({
    data: { number: "C-0001", name: "Dana Levi", phone: "050-123-4567", phoneNormalized: "0501234567", email: "dana@example.com", emailNormalized: "dana@example.com" },
  });
  return { user, policy, material, printer, customer };
}

export function printLine(materialId: string, printerId: string, over: Partial<LineForm> = {}): LineForm {
  return {
    id: null,
    serviceType: "PRINT_ONLY",
    partName: "Bracket",
    description: null,
    category: null,
    quantity: 4,
    colorNote: null,
    deadline: null,
    specialInstructions: null,
    materialId,
    supportMaterialId: null,
    printerId,
    designProjectId: null,
    gramsPerUnit: "50",
    supportGramsPerUnit: null,
    purgeGramsPerBatch: null,
    unitsPerBatch: 2,
    printMinutesPerUnit: "120",
    setupMinutesPerBatch: null,
    postProcessMinutesPerUnit: null,
    extraCostPerUnit: null,
    extraCostNote: null,
    modelingMode: "HOURLY",
    modelingHours: null,
    modelingFee: null,
    designFeeWaived: false,
    waivedReason: null,
    scanHours: null,
    scanCleanupHours: null,
    reverseEngineeringHours: null,
    discountType: null,
    discountValue: null,
    manualUnitPrice: null,
    manualPriceReason: null,
    ...over,
  };
}

export function quoteForm(customerId: string, lines: LineForm[], over: Partial<QuoteForm> = {}): QuoteForm {
  return {
    customerId,
    title: "Test quote",
    pricingPolicyId: null,
    orderDiscountType: null,
    orderDiscountValue: null,
    shippingMethod: null,
    shippingCharge: null,
    shippingCost: null,
    depositPercent: null,
    paymentTerms: null,
    customerNotes: null,
    internalNotes: null,
    refreshRates: false,
    lines,
    validUntil: new Date(Date.now() + 7 * 86400000),
    requestedBy: null,
    ...over,
  };
}

export function orderForm(customerId: string, lines: LineForm[], over: Partial<OrderForm> = {}): OrderForm {
  const { validUntil: _v, requestedBy: _r, ...base } = quoteForm(customerId, lines);
  void _v;
  void _r;
  return { ...base, dueDate: null, priority: "NORMAL", deliveryMethod: "PICKUP", deliveryAddress: null, confirm: false, ...over };
}

export async function addSpool(materialId: string, grams = "1000", code = `SP-${Math.random().toString(36).slice(2, 8)}`) {
  const spool = await prisma.spool.create({ data: { code, materialId, netWeightG: grams, remainingG: grams, landedCost: "90", status: "SEALED" } });
  await prisma.stockMovement.create({ data: { materialId, spoolId: spool.id, type: "RECEIVED", quantityG: grams, costPerKg: "90" } });
  return spool;
}
