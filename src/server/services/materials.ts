import "server-only";
import { prisma, type Tx } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { D, ZERO, dec, decOrNull, roundMoney } from "@/domain/money";
import type { ResolvedMaterial } from "@/domain/pricing/types";
import { NotFoundError, ServiceError, audit, nextNumber } from "./common";
import { getSettings } from "./settings";

export function materialLabel(m: { brand: string; productLine: string | null; colorName: string; materialType: { code: string } }) {
  return `${m.materialType.code} · ${m.brand}${m.productLine ? ` ${m.productLine}` : ""} · ${m.colorName}`;
}

export function toResolvedMaterial(m: {
  id: string;
  brand: string;
  productLine: string | null;
  colorName: string;
  pricePerKg: { toString(): string } | null;
  wastePercent: { toString(): string } | null;
  materialType: { code: string };
}): ResolvedMaterial {
  return { id: m.id, label: materialLabel(m), pricePerKg: m.pricePerKg?.toString() ?? null, wastePercent: m.wastePercent?.toString() ?? null };
}

export async function resolveMaterial(tx: Tx | typeof prisma, id: string | null): Promise<ResolvedMaterial | null> {
  if (!id) return null;
  const m = await tx.material.findUnique({ where: { id }, include: { materialType: { select: { code: true } } } });
  if (!m) throw new ServiceError("A selected material no longer exists.");
  return toResolvedMaterial(m);
}

export interface StockSummary {
  onHandG: string;
  reservedG: string;
  availableG: string;
  spoolCount: number;
  hasEstimates: boolean;
  lowStock: boolean;
  /** Estimated weights close to the threshold — suggest weighing. */
  nearThreshold: boolean;
}

/** Stock per material: on hand (spools), reserved (active reservations), available. */
export async function stockSummaries(materialIds?: string[]): Promise<Map<string, StockSummary>> {
  const whereM = materialIds ? { materialId: { in: materialIds } } : {};
  const [spools, reservations, materials] = await Promise.all([
    prisma.spool.groupBy({ by: ["materialId", "remainingIsMeasured"], where: { ...whereM, status: { in: ["SEALED", "OPEN"] } }, _sum: { remainingG: true }, _count: true }),
    prisma.materialReservation.groupBy({ by: ["materialId"], where: { ...whereM, status: "ACTIVE" }, _sum: { quantityG: true, consumedG: true } }),
    prisma.material.findMany({ where: materialIds ? { id: { in: materialIds } } : {}, select: { id: true, minStockG: true } }),
  ]);
  const map = new Map<string, StockSummary>();
  for (const m of materials) {
    const rows = spools.filter((s) => s.materialId === m.id);
    const onHand = rows.reduce((a, r) => a.plus(dec(r._sum.remainingG?.toString() ?? "0")), ZERO);
    const count = rows.reduce((a, r) => a + r._count, 0);
    const hasEstimates = rows.some((r) => !r.remainingIsMeasured && r._count > 0);
    const res = reservations.find((r) => r.materialId === m.id);
    const reserved = res ? D.max(ZERO, dec(res._sum.quantityG?.toString() ?? "0").minus(dec(res._sum.consumedG?.toString() ?? "0"))) : ZERO;
    const available = onHand.minus(reserved);
    const min = new D(m.minStockG);
    map.set(m.id, {
      onHandG: onHand.toFixed(2),
      reservedG: reserved.toFixed(2),
      availableG: available.toFixed(2),
      spoolCount: count,
      hasEstimates,
      lowStock: min.gt(0) && available.lt(min),
      nearThreshold: min.gt(0) && hasEstimates && !available.lt(min) && available.lt(min.times(1.2)),
    });
  }
  return map;
}

export type MaterialFilter = "active" | "low" | "inactive" | "all";

export async function listMaterials(opts: { q?: string; type?: string; filter?: MaterialFilter } = {}) {
  const where: Prisma.MaterialWhereInput = {};
  if (opts.filter === "inactive") where.isActive = false;
  else if (opts.filter !== "all") where.isActive = true;
  if (opts.type) where.materialType = { code: opts.type };
  const q = opts.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ brand: ci }, { productLine: ci }, { colorName: ci }, { sku: ci }, { storageLocation: ci }, { materialType: { code: ci } }];
  }
  const materials = await prisma.material.findMany({
    where,
    include: { materialType: { select: { code: true, name: true } }, supplier: { select: { name: true } } },
    orderBy: [{ materialType: { code: "asc" } }, { brand: "asc" }, { colorName: "asc" }],
  });
  const stock = await stockSummaries(materials.map((m) => m.id));
  let rows = materials.map((m) => ({ ...m, stock: stock.get(m.id)! }));
  if (opts.filter === "low") rows = rows.filter((r) => r.stock.lowStock || r.stock.nearThreshold);
  return rows;
}

export async function getMaterial(id: string) {
  const m = await prisma.material.findUnique({
    where: { id },
    include: {
      materialType: true,
      supplier: true,
      spools: { orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { supplier: { select: { name: true } } } },
      movements: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { spool: { select: { code: true } }, printJob: { select: { id: true, number: true } }, orderItem: { select: { order: { select: { id: true, number: true } } } } },
      },
      reservations: { where: { status: "ACTIVE" }, include: { orderItem: { select: { partName: true, order: { select: { id: true, number: true, status: true } } } } } },
    },
  });
  if (!m) return null;
  const stock = (await stockSummaries([id])).get(id)!;
  return { material: m, stock };
}

export interface MaterialInput {
  materialTypeId: string;
  brand: string;
  productLine: string | null;
  colorName: string;
  colorHex: string | null;
  diameterMm: string | null;
  densityGcm3: string | null;
  pricePerKg: string | null;
  wastePercent: string | null;
  defaultSpoolNetG: number | null;
  emptySpoolWeightG: number | null;
  minStockG: number | null;
  sku: string | null;
  supplierId: string | null;
  storageLocation: string | null;
  notes: string | null;
  isActive: boolean;
}

function materialData(i: MaterialInput) {
  return {
    materialTypeId: i.materialTypeId,
    brand: i.brand,
    productLine: i.productLine,
    colorName: i.colorName,
    colorHex: i.colorHex,
    diameterMm: i.diameterMm ?? "1.75",
    densityGcm3: i.densityGcm3,
    pricePerKg: i.pricePerKg,
    wastePercent: i.wastePercent,
    defaultSpoolNetG: i.defaultSpoolNetG ?? 1000,
    emptySpoolWeightG: i.emptySpoolWeightG,
    minStockG: i.minStockG ?? 0,
    sku: i.sku,
    supplierId: i.supplierId,
    storageLocation: i.storageLocation,
    notes: i.notes,
    isActive: i.isActive,
  };
}

export async function saveMaterial(userId: string, id: string | null, input: MaterialInput) {
  return prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.material.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Material");
      const m = await tx.material.update({ where: { id }, data: materialData(input) });
      const priceChanged = String(before.pricePerKg ?? "") !== String(m.pricePerKg ?? "");
      await audit(tx, {
        userId,
        entityType: "MATERIAL",
        entityId: id,
        action: "UPDATE",
        summary: priceChanged ? `Price per kg ${before.pricePerKg ?? "unset"} → ${m.pricePerKg ?? "unset"} (existing quotes keep their snapshot)` : "Updated material",
      });
      return m;
    }
    const m = await tx.material.create({ data: materialData(input) });
    await audit(tx, { userId, entityType: "MATERIAL", entityId: m.id, action: "CREATE", summary: `Created material ${m.brand} ${m.colorName}` });
    return m;
  });
}

export interface ReceiveInput {
  materialId: string;
  spoolCount: number;
  netWeightG: string;
  /** Price paid per spool as entered (see pricesIncludeVat). */
  pricePerSpool: string;
  shippingTotal: string | null;
  pricesIncludeVat: boolean;
  supplierId: string | null;
  purchasedAt: Date | null;
  storageLocation: string | null;
  reference: string | null;
  recordExpense: boolean;
  updateMaterialPrice: boolean;
}

/**
 * Receives purchased spools: creates spools with landed cost (price + allocated shipping,
 * excluding reclaimable VAT for VAT-registered businesses), RECEIVED movements, and optionally
 * the purchase expense and a material price update.
 */
export async function receiveSpools(userId: string, input: ReceiveInput) {
  if (input.spoolCount < 1 || input.spoolCount > 200) throw new ServiceError("Spool count must be between 1 and 200.");
  const net = dec(input.netWeightG);
  if (net.lte(0)) throw new ServiceError("Net weight must be greater than zero.");
  const settings = await getSettings();
  const vatRate = dec(settings.vatRate.toString());
  const reclaimVat = settings.vatMode === "EXCLUSIVE" && input.pricesIncludeVat;
  const grossPer = dec(input.pricePerSpool);
  const shipping = decOrNull(input.shippingTotal) ?? ZERO;
  if (grossPer.lt(0) || shipping.lt(0)) throw new ServiceError("Prices cannot be negative.");
  const toNet = (v: InstanceType<typeof D>) => (reclaimVat ? v.div(vatRate.plus(1)) : v);
  const landedPer = roundMoney(toNet(grossPer).plus(toNet(shipping).div(input.spoolCount)));
  const pricePerKg = roundMoney(landedPer.div(net.div(1000)));
  const totalPaid = roundMoney(grossPer.times(input.spoolCount).plus(shipping));
  const vatPaid = input.pricesIncludeVat && settings.vatMode === "EXCLUSIVE" ? roundMoney(totalPaid.minus(totalPaid.div(vatRate.plus(1)))) : ZERO;

  return prisma.$transaction(async (tx) => {
    const material = await tx.material.findUnique({ where: { id: input.materialId }, include: { materialType: true } });
    if (!material) throw new NotFoundError("Material");
    let expenseId: string | null = null;
    if (input.recordExpense) {
      const e = await tx.expense.create({
        data: {
          date: input.purchasedAt ?? new Date(),
          category: "MATERIALS",
          description: `${input.spoolCount} × ${materialLabel(material)}`,
          supplierId: input.supplierId,
          amount: totalPaid.toFixed(2),
          vatAmount: vatPaid.toFixed(2),
          reference: input.reference,
        },
      });
      expenseId = e.id;
    }
    const codes: string[] = [];
    for (let i = 0; i < input.spoolCount; i++) {
      const code = await nextNumber(tx, "SPOOL");
      codes.push(code);
      const spool = await tx.spool.create({
        data: {
          code,
          materialId: material.id,
          supplierId: input.supplierId,
          expenseId,
          purchasedAt: input.purchasedAt,
          landedCost: landedPer.toFixed(2),
          netWeightG: net.toFixed(2),
          remainingG: net.toFixed(2),
          remainingIsMeasured: false,
          status: "SEALED",
          storageLocation: input.storageLocation ?? material.storageLocation,
        },
      });
      await tx.stockMovement.create({
        data: {
          materialId: material.id,
          spoolId: spool.id,
          type: "RECEIVED",
          quantityG: net.toFixed(2),
          costPerKg: pricePerKg.toFixed(4),
          reason: input.reference ? `Purchase ${input.reference}` : "Purchase",
          createdById: userId,
        },
      });
    }
    if (input.updateMaterialPrice) await tx.material.update({ where: { id: material.id }, data: { pricePerKg: pricePerKg.toFixed(2) } });
    await audit(tx, {
      userId,
      entityType: "MATERIAL",
      entityId: material.id,
      action: "RECEIVE",
      summary: `Received ${input.spoolCount} spool(s) ${codes[0]}${codes.length > 1 ? `–${codes[codes.length - 1]}` : ""}; landed ${landedPer.toFixed(2)}/spool (${pricePerKg.toFixed(2)}/kg)`,
    });
    return { codes, landedPer: landedPer.toFixed(2), pricePerKg: pricePerKg.toFixed(2) };
  });
}

/** Weigh-in: sets a spool's remaining weight from a scale reading and records the difference. */
export async function reconcileSpool(userId: string, spoolId: string, input: { grossWeightG?: string | null; remainingG?: string | null; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    // Row lock prevents a concurrent consumption from being lost between read and write.
    await tx.$queryRaw`SELECT id FROM "Spool" WHERE id = ${spoolId} FOR UPDATE`;
    const spool = await tx.spool.findUnique({ where: { id: spoolId }, include: { material: true } });
    if (!spool) throw new NotFoundError("Spool");
    let remaining: InstanceType<typeof D>;
    if (input.remainingG) remaining = dec(input.remainingG);
    else if (input.grossWeightG) {
      if (spool.material.emptySpoolWeightG === null) throw new ServiceError("Set the empty spool weight on the material first, or enter the net filament weight directly.");
      remaining = dec(input.grossWeightG).minus(spool.material.emptySpoolWeightG);
    } else throw new ServiceError("Enter a scale reading.");
    if (remaining.lt(0)) remaining = ZERO;
    if (remaining.gt(dec(spool.netWeightG.toString()).times(1.1))) throw new ServiceError("The reading is more than the spool's original net weight. Check the empty spool weight.");
    const delta = remaining.minus(dec(spool.remainingG.toString()));
    await tx.spool.update({
      where: { id: spoolId },
      data: {
        remainingG: remaining.toFixed(2),
        remainingIsMeasured: true,
        lastWeighedAt: new Date(),
        status: remaining.lte(0) ? "EMPTY" : remaining.lt(dec(spool.netWeightG.toString())) ? "OPEN" : spool.status,
      },
    });
    if (!delta.eq(0))
      await tx.stockMovement.create({
        data: { materialId: spool.materialId, spoolId, type: "RECONCILIATION", quantityG: delta.toFixed(2), reason: input.note ?? "Weigh-in", createdById: userId, costPerKg: spoolCostPerKg(spool) },
      });
    await audit(tx, {
      userId,
      entityType: "SPOOL",
      entityId: spoolId,
      action: "RECONCILE",
      summary: `Weighed ${spool.code}: ${remaining.toFixed(0)} g (${delta.gte(0) ? "+" : ""}${delta.toFixed(0)} g vs estimate)`,
    });
    return { remaining: remaining.toFixed(2), delta: delta.toFixed(2) };
  });
}

export function spoolCostPerKg(spool: { landedCost: { toString(): string } | null; netWeightG: { toString(): string } }): string | null {
  if (!spool.landedCost) return null;
  const net = dec(spool.netWeightG.toString());
  return net.gt(0) ? dec(spool.landedCost.toString()).div(net.div(1000)).toFixed(4) : null;
}

/**
 * Removes grams from a spool atomically. Uses a conditional UPDATE so two concurrent
 * deductions can never both succeed against the same grams.
 */
export async function deductFromSpool(tx: Tx, spoolId: string, grams: InstanceType<typeof D>) {
  const updated = await tx.$executeRaw`
    UPDATE "Spool" SET "remainingG" = "remainingG" - ${grams.toFixed(2)}::numeric,
      "status" = CASE WHEN "remainingG" - ${grams.toFixed(2)}::numeric <= 0 THEN 'EMPTY'::"SpoolStatus" ELSE 'OPEN'::"SpoolStatus" END,
      "updatedAt" = now()
    WHERE id = ${spoolId} AND "remainingG" >= ${grams.toFixed(2)}::numeric AND status IN ('SEALED', 'OPEN')`;
  if (updated !== 1) {
    const s = await tx.spool.findUnique({ where: { id: spoolId }, select: { code: true, remainingG: true, status: true } });
    if (!s) throw new NotFoundError("Spool");
    throw new ServiceError(`Spool ${s.code} has only ≈${Number(s.remainingG).toFixed(0)} g recorded (${s.status.toLowerCase()}). Weigh it to correct the estimate, or split the usage across spools.`);
  }
}

export async function recordWaste(userId: string, spoolId: string, grams: string, reason: string) {
  const g = dec(grams);
  if (g.lte(0)) throw new ServiceError("Enter the wasted grams.");
  if (!reason || reason.trim().length < 3) throw new ServiceError("Give a short reason.");
  return prisma.$transaction(async (tx) => {
    const spool = await tx.spool.findUnique({ where: { id: spoolId } });
    if (!spool) throw new NotFoundError("Spool");
    await deductFromSpool(tx, spoolId, g);
    await tx.stockMovement.create({
      data: { materialId: spool.materialId, spoolId, type: "WASTE", quantityG: g.neg().toFixed(2), reason: reason.trim(), createdById: userId, costPerKg: spoolCostPerKg(spool) },
    });
    await audit(tx, { userId, entityType: "SPOOL", entityId: spoolId, action: "WASTE", summary: `Waste ${g.toFixed(0)} g from ${spool.code}: ${reason.trim()}` });
  });
}

export async function setSpoolStatus(userId: string, spoolId: string, status: "EMPTY" | "DISCARDED" | "OPEN") {
  return prisma.$transaction(async (tx) => {
    const spool = await tx.spool.findUnique({ where: { id: spoolId } });
    if (!spool) throw new NotFoundError("Spool");
    const remaining = dec(spool.remainingG.toString());
    if ((status === "EMPTY" || status === "DISCARDED") && remaining.gt(0)) {
      await tx.stockMovement.create({
        data: {
          materialId: spool.materialId,
          spoolId,
          type: status === "EMPTY" ? "ADJUSTMENT" : "WASTE",
          quantityG: remaining.neg().toFixed(2),
          reason: status === "EMPTY" ? "Marked empty" : "Discarded",
          createdById: userId,
          costPerKg: spoolCostPerKg(spool),
        },
      });
    }
    await tx.spool.update({ where: { id: spoolId }, data: { status, ...(status !== "OPEN" ? { remainingG: "0" } : {}) } });
    await audit(tx, { userId, entityType: "SPOOL", entityId: spoolId, action: "STATUS", summary: `${spool.code} marked ${status.toLowerCase()}` });
  });
}

export async function listMaterialTypes() {
  return prisma.materialType.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { materials: true } } } });
}

export async function createMaterialType(userId: string, input: { code: string; name: string; defaultDensity: string | null; description: string | null }) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9+\-]{2,20}$/.test(code)) throw new ServiceError("Code must be 2–20 letters, digits, + or -.");
  return prisma.$transaction(async (tx) => {
    const t = await tx.materialType.create({ data: { code, name: input.name.trim(), defaultDensity: input.defaultDensity, description: input.description } });
    await audit(tx, { userId, entityType: "MATERIAL_TYPE", entityId: t.id, action: "CREATE", summary: `Created material type ${code}` });
    return t;
  });
}

export async function listSuppliers() {
  return prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

export async function createSupplier(userId: string, input: { name: string; website: string | null; contactName: string | null; email: string | null; phone: string | null; notes: string | null }) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: { ...input, name: input.name.trim() } });
    await audit(tx, { userId, entityType: "SUPPLIER", entityId: s.id, action: "CREATE", summary: `Created supplier ${s.name}` });
    return s;
  });
}

/** Options for pickers in quote/order editors (plain, serializable). */
export async function materialOptions() {
  const ms = await prisma.material.findMany({
    where: { isActive: true },
    include: { materialType: { select: { code: true } } },
    orderBy: [{ materialType: { code: "asc" } }, { brand: "asc" }, { colorName: "asc" }],
  });
  const stock = await stockSummaries(ms.map((m) => m.id));
  return ms.map((m) => ({
    id: m.id,
    label: materialLabel(m),
    typeCode: m.materialType.code,
    colorHex: m.colorHex,
    pricePerKg: m.pricePerKg?.toString() ?? null,
    wastePercent: m.wastePercent?.toString() ?? null,
    availableG: stock.get(m.id)?.availableG ?? "0",
  }));
}
