/**
 * Seeds a DEMO database with realistic sample data, using the real services so every
 * business rule applies. Safety rules:
 *  - refuses when APP_ENV=production
 *  - refuses when the database contains data that is not flagged as demo
 *  - re-seeding a demo database wipes it first
 * Usage: DATABASE_URL=postgresql://…/printforge_demo npm run db:seed:demo
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  const { prisma } = await import("../src/server/db");
  const { hashPassword } = await import("../src/server/auth/password");
  const { seedReferenceData } = await import("../src/server/services/reference-data");

  const [users, settings] = await Promise.all([prisma.user.count(), prisma.settings.findUnique({ where: { id: 1 } })]);
  if (users > 0 && !settings?.isDemo) {
    throw new Error("This database already contains non-demo data. Point DATABASE_URL at a separate demo database (e.g. printforge_demo).");
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);

  const { saveQuote, sendQuote, acceptQuote } = await import("../src/server/services/quotes");
  const { saveOrder, transitionOrder } = await import("../src/server/services/orders");
  const { recordPayment } = await import("../src/server/services/payments");
  const { receiveSpools } = await import("../src/server/services/materials");
  const { createJobsForOrder, startJob, finishPrint } = await import("../src/server/services/production");
  const { transitionDesign, logTime } = await import("../src/server/services/designs");
  const { saveExpense } = await import("../src/server/services/finance");
  const { saveMaintenanceTask } = await import("../src/server/services/printers");

  const password = process.env.DEMO_PASSWORD || `demo-${randomBytes(6).toString("hex")}`;
  const user = await prisma.user.create({ data: { email: "demo@printforge.local", name: "Noa Demo", passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
  await prisma.settings.create({
    data: {
      id: 1,
      isDemo: true,
      businessName: "Forge & Filament (DEMO)",
      legalName: "Forge & Filament Demo Ltd.",
      businessTaxId: "000000000",
      addressLine1: "12 Example St.",
      city: "Tel Aviv",
      postalCode: "6100000",
      phone: "03-000-0000",
      email: "hello@example.com",
      vatMode: "EXCLUSIVE",
      vatRate: "0.18",
      electricityTariffPerKwh: "0.64",
      laborCostPerHour: "70",
      defaultSetupMinutes: "10",
      materialWastePercent: "0.05",
      failureAllowancePercent: "0.08",
      contingencyPercent: "0.03",
      packingCostPerOrder: "6",
      transactionFeePercent: "0.015",
      modelingRatePerHour: "180",
      scanningRatePerHour: "220",
      defaultDepositPercent: "0",
      quoteTerms: "Colors may vary slightly between filament batches. Lead time starts once the deposit and final design approval are received.",
      documentFooter: "Thank you for choosing Forge & Filament — demo data only.",
    },
  });
  await prisma.$transaction((tx) => seedReferenceData(tx));
  await prisma.pricingPolicy.create({ data: { name: "Standard", description: "Retail pricing", method: "MARKUP", markupPercent: "1.2", minimumOrderCharge: "40", minimumMarginPercent: "0.3", priceRoundingStep: "1", isDefault: true } });
  await prisma.pricingPolicy.create({ data: { name: "Wholesale", description: "Repeat B2B customers, larger batches", method: "MARGIN", marginPercent: "0.35", minimumOrderCharge: "200", minimumMarginPercent: "0.2", priceRoundingStep: "0.1" } });

  const type = async (code: string) => (await prisma.materialType.findUniqueOrThrow({ where: { code } })).id;
  const [pla, petg, asa, abs, tpu] = await Promise.all(["PLA", "PETG", "ASA", "ABS", "TPU"].map(type));
  const supplier = await prisma.supplier.create({ data: { name: "Bambu Lab Store (EU)", website: "https://example.com" } });
  const mk = (materialTypeId: string, brand: string, productLine: string, colorName: string, colorHex: string, minStockG: number) =>
    prisma.material.create({ data: { materialTypeId, brand, productLine, colorName, colorHex, minStockG, emptySpoolWeightG: 250, supplierId: supplier.id, storageLocation: "Dry box A" } });
  const mPlaBlack = await mk(pla, "Bambu Lab", "PLA Basic", "Black", "#1b1b1b", 1500);
  const mPlaWhite = await mk(pla, "Bambu Lab", "PLA Matte", "Ivory White", "#f1ede4", 1000);
  const mPetgBlue = await mk(petg, "Bambu Lab", "PETG HF", "Blue", "#2f5fb3", 800);
  const mAsaGrey = await mk(asa, "Polymaker", "ASA", "Grey", "#8a8d91", 800);
  const mAbsBlack = await mk(abs, "eSun", "ABS+", "Black", "#202020", 500);
  const mTpu = await mk(tpu, "Bambu Lab", "TPU 95A HF", "Red", "#c73a3a", 0);
  const receive = (materialId: string, n: number, price: string) =>
    receiveSpools(user.id, { materialId, spoolCount: n, netWeightG: "1000", pricePerSpool: price, shippingTotal: "35", pricesIncludeVat: true, supplierId: supplier.id, purchasedAt: new Date(Date.now() - 20 * 86400000), storageLocation: null, reference: "INV-DEMO", recordExpense: true, updateMaterialPrice: true });
  await receive(mPlaBlack.id, 3, "95");
  await receive(mPlaWhite.id, 2, "105");
  await receive(mPetgBlue.id, 2, "99");
  await receive(mAsaGrey.id, 1, "129");
  await receive(mAbsBlack.id, 1, "85");
  await receive(mTpu.id, 1, "149");

  const common = await prisma.materialType.findMany({ where: { code: { in: ["PLA", "PETG", "ABS", "ASA", "TPU", "PLA-CF", "PETG-CF", "PVA"] } } });
  const x1c = await prisma.printer.create({ data: { name: "X1C #1", manufacturer: "Bambu Lab", model: "X1 Carbon", hasMultiMaterial: true, nozzleNotes: "Hardened steel", buildVolume: "256 × 256 × 256 mm", purchasePrice: "6500", expectedLifetimeHours: 6000, powerWatts: 150, maintenancePerHour: "0.30", consumablesPerHour: "0.20", initialPrintHours: "812", supportedMaterialTypes: { connect: common.map((t) => ({ id: t.id })) } } });
  const p1s = await prisma.printer.create({ data: { name: "P1S #1", manufacturer: "Bambu Lab", model: "P1S", hasMultiMaterial: true, purchasePrice: "3900", expectedLifetimeHours: 5000, powerWatts: 130, maintenancePerHour: "0.25", consumablesPerHour: "0.15", initialPrintHours: "455", supportedMaterialTypes: { connect: common.filter((t) => ["PLA", "PETG", "ABS", "ASA", "TPU"].includes(t.code)).map((t) => ({ id: t.id })) } } });
  const a1 = await prisma.printer.create({ data: { name: "A1 mini", manufacturer: "Bambu Lab", model: "A1 mini", purchasePrice: "1050", expectedLifetimeHours: 3000, powerWatts: 80, maintenancePerHour: "0.15", consumablesPerHour: "0.10", initialPrintHours: "231", supportedMaterialTypes: { connect: common.filter((t) => ["PLA", "PETG", "TPU"].includes(t.code)).map((t) => ({ id: t.id })) } } });
  await saveMaintenanceTask(user.id, x1c.id, { title: "Clean & lubricate carbon rods", intervalPrintHours: 200, intervalDays: null, notes: null });
  await saveMaintenanceTask(user.id, p1s.id, { title: "Replace hotend nozzle", intervalPrintHours: null, intervalDays: 90, notes: null });
  await prisma.maintenanceTask.updateMany({ where: { printerId: p1s.id }, data: { lastDoneAt: new Date(Date.now() - 88 * 86400000) } });

  const customer = (i: number, name: string, extra: Record<string, unknown> = {}) =>
    prisma.customer.create({ data: { number: `C-${String(i).padStart(4, "0")}`, name, preferredContact: "WHATSAPP", country: "Israel", ...extra } });
  const cDana = await customer(1, "דנה לוי (Dana Levi)", { phone: "050-111-2233", phoneNormalized: "0501112233", email: "dana@example.com", emailNormalized: "dana@example.com", city: "Tel Aviv", addressLine1: "Dizengoff 100" });
  const cRobotics = await customer(2, "Yoav Cohen", { company: "Galil Robotics", phone: "052-444-5566", phoneNormalized: "0524445566", email: "yoav@example.com", emailNormalized: "yoav@example.com", city: "Haifa", taxId: "515000000", tags: ["wholesale", "b2b"], preferredContact: "EMAIL" });
  const cMaya = await customer(3, "Maya Ben-David", { phone: "054-777-8899", phoneNormalized: "0547778899", city: "Jerusalem", tags: ["cosplay"] });
  const cOmer = await customer(4, "Omer Friedman", { phone: "053-222-3344", phoneNormalized: "0532223344", email: "omer@example.com", emailNormalized: "omer@example.com", city: "Ramat Gan" });
  await customer(5, "Tamar Shapiro", { phone: "058-999-0011", phoneNormalized: "0589990011", city: "Be'er Sheva" });
  await prisma.numberSequence.upsert({ where: { key: "CUSTOMER" }, create: { key: "CUSTOMER", prefix: "C", includeYear: false, padding: 4, nextValue: 6 }, update: { nextValue: 6 } });
  const wholesale = await prisma.pricingPolicy.findFirstOrThrow({ where: { name: "Wholesale" } });
  await prisma.customer.update({ where: { id: cRobotics.id }, data: { pricingPolicyId: wholesale.id } });

  const line = (o: Record<string, unknown>) => ({
    id: null, serviceType: "PRINT_ONLY" as const, partName: "Part", description: null, category: null, quantity: 1, colorNote: null, deadline: null, specialInstructions: null,
    materialId: mPlaBlack.id, supportMaterialId: null, printerId: x1c.id, designProjectId: null, gramsPerUnit: "40", supportGramsPerUnit: null, purgeGramsPerBatch: null, unitsPerBatch: 1, printMinutesPerUnit: "90",
    setupMinutesPerBatch: null, postProcessMinutesPerUnit: null, extraCostPerUnit: null, extraCostNote: null, modelingMode: "HOURLY" as const, modelingHours: null, modelingFee: null, designFeeWaived: false, waivedReason: null,
    scanHours: null, scanCleanupHours: null, reverseEngineeringHours: null, discountType: null, discountValue: null, manualUnitPrice: null, manualPriceReason: null, ...o,
  });
  const doc = { title: null, pricingPolicyId: null, orderDiscountType: null, orderDiscountValue: null, shippingMethod: null, shippingCharge: null, shippingCost: null, depositPercent: null, paymentTerms: null, customerNotes: null, internalNotes: null, refreshRates: false };
  const orderDoc = { ...doc, dueDate: null, priority: "NORMAL" as const, deliveryMethod: "PICKUP" as const, deliveryAddress: null, confirm: true };
  const days = (n: number) => new Date(Date.now() + n * 86400000);

  // 1. Completed & paid order (full lifecycle).
  const o1 = await saveOrder(user.id, null, { ...orderDoc, customerId: cOmer.id, title: "Desk cable organizers", lines: [line({ partName: "Cable clip set", quantity: 6, unitsPerBatch: 6, gramsPerUnit: "12", printMinutesPerUnit: "22", printerId: p1s.id })] });
  await createJobsForOrder(user.id, o1.id);
  const spoolBlack = await prisma.spool.findFirstOrThrow({ where: { materialId: mPlaBlack.id } });
  for (const j of await prisma.printJob.findMany({ where: { orderId: o1.id } })) {
    await startJob(user.id, j.id);
    await finishPrint(user.id, j.id, { outcome: "DONE", actualMinutes: "140", consumption: [{ spoolId: spoolBlack.id, materialId: null, grams: "79" }], good: {}, failureReason: null, notes: null });
  }
  await transitionOrder(user.id, o1.id, "DELIVERED");
  const o1r = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
  await recordPayment(user.id, o1.id, { kind: "PAYMENT", method: "BIT", amount: o1r.total.toString(), isDeposit: false, receivedAt: null, reference: "BIT", feeAmount: null, notes: null, idempotencyKey: null });
  await transitionOrder(user.id, o1.id, "COMPLETED");

  // 2. Wholesale order in production, deposit paid, one job printing.
  const o2 = await saveOrder(user.id, null, {
    ...orderDoc,
    customerId: cRobotics.id,
    pricingPolicyId: wholesale.id,
    title: "Robot gripper fingers — batch 3",
    dueDate: days(4),
    priority: "HIGH",
    deliveryMethod: "COURIER",
    shippingCharge: "45",
    shippingCost: "32",
    depositPercent: "0.3",
    lines: [
      line({ partName: "Gripper finger (left)", quantity: 20, unitsPerBatch: 10, materialId: mPetgBlue.id, gramsPerUnit: "18.5", supportGramsPerUnit: "2", printMinutesPerUnit: "34", postProcessMinutesPerUnit: "2" }),
      line({ partName: "Gripper finger (right)", quantity: 20, unitsPerBatch: 10, materialId: mPetgBlue.id, gramsPerUnit: "18.5", supportGramsPerUnit: "2", printMinutesPerUnit: "34", postProcessMinutesPerUnit: "2", printerId: p1s.id }),
      line({ partName: "Mounting bracket", quantity: 8, unitsPerBatch: 4, materialId: mAsaGrey.id, gramsPerUnit: "46", printMinutesPerUnit: "71", extraCostPerUnit: "1.2", extraCostNote: "M3 heat-set inserts ×4" }),
    ],
  });
  const o2r = await prisma.order.findUniqueOrThrow({ where: { id: o2.id } });
  await recordPayment(user.id, o2.id, { kind: "PAYMENT", method: "BANK_TRANSFER", amount: o2r.depositAmount.toString(), isDeposit: true, receivedAt: days(-2), reference: "TRF-88121", feeAmount: null, notes: null, idempotencyKey: null });
  await createJobsForOrder(user.id, o2.id);
  const o2jobs = await prisma.printJob.findMany({ where: { orderId: o2.id }, orderBy: { number: "asc" } });
  await startJob(user.id, o2jobs[0].id);

  // 3. Modeling + printing order waiting for design approval.
  const o3 = await saveOrder(user.id, null, {
    ...orderDoc,
    customerId: cMaya.id,
    title: "Cosplay helmet",
    dueDate: days(12),
    depositPercent: "0.5",
    lines: [line({ serviceType: "MODELING_AND_PRINTING", partName: "Sci-fi helmet (4 parts)", quantity: 1, materialId: mPlaWhite.id, gramsPerUnit: "820", supportGramsPerUnit: "140", printMinutesPerUnit: "1560", postProcessMinutesPerUnit: "180", modelingMode: "FIXED", modelingFee: "650", modelingHours: "5" })],
  });
  const o3r = await prisma.order.findUniqueOrThrow({ where: { id: o3.id }, include: { items: true } });
  await recordPayment(user.id, o3.id, { kind: "PAYMENT", method: "CREDIT_CARD", amount: o3r.depositAmount.toString(), isDeposit: true, receivedAt: days(-1), reference: null, feeAmount: "9.80", notes: null, idempotencyKey: null });
  const design = o3r.items[0].designProjectId!;
  await logTime(user.id, design, { category: "MODELING", hours: "3.5", date: days(-1), billable: true, notes: "Base shape and visor" });
  await transitionDesign(user.id, design, "AWAITING_APPROVAL", null);

  // 4. Sent quote with scanning, and a draft quote.
  const q1 = await saveQuote(user.id, null, {
    ...doc,
    customerId: cDana.id,
    title: "Vintage knob replacement",
    validUntil: days(10),
    requestedBy: null,
    lines: [
      line({ serviceType: "SCANNING_AND_PRINTING", partName: "Radio knob (scan + print)", quantity: 4, materialId: mAbsBlack.id, gramsPerUnit: "9", printMinutesPerUnit: "28", scanHours: "0.75", scanCleanupHours: "1", reverseEngineeringHours: "1.5", printerId: x1c.id }),
    ],
  });
  await sendQuote(user.id, q1.id);
  await saveQuote(user.id, null, { ...doc, customerId: cOmer.id, title: "Phone stand (draft)", validUntil: days(14), requestedBy: null, lines: [line({ partName: "Phone stand", quantity: 2, materialId: mPlaWhite.id, gramsPerUnit: "65", printMinutesPerUnit: "150", printerId: a1.id })] });

  // 5. Accepted quote → order that is queued.
  const q2 = await saveQuote(user.id, null, { ...doc, customerId: cDana.id, title: "Planter set", validUntil: days(7), requestedBy: days(9), lines: [line({ partName: "Hex planter", quantity: 3, unitsPerBatch: 1, materialId: mPlaWhite.id, gramsPerUnit: "110", printMinutesPerUnit: "240", printerId: p1s.id }), line({ partName: "Drip tray", quantity: 3, unitsPerBatch: 3, materialId: mTpu.id, gramsPerUnit: "25", printMinutesPerUnit: "45", printerId: a1.id })] });
  await sendQuote(user.id, q2.id);
  await acceptQuote(user.id, q2.id, "Approved on WhatsApp", true);

  // Expenses.
  await saveExpense(user.id, null, { date: days(-10), category: "SOFTWARE", description: "Fusion 360 subscription", supplierId: null, amount: "220", vatAmount: "33.56", paymentMethod: "CREDIT_CARD", reference: null, printerId: null, orderId: null, notes: null });
  await saveExpense(user.id, null, { date: days(-5), category: "SHIPPING", description: "Courier account top-up", supplierId: null, amount: "150", vatAmount: "22.88", paymentMethod: "CREDIT_CARD", reference: null, printerId: null, orderId: null, notes: null });

  console.log("\nDemo data ready.");
  console.log("  Sign in:  demo@printforge.local");
  console.log(`  Password: ${password}`);
  console.log("  The app shows a DEMO banner for this database.\n");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
