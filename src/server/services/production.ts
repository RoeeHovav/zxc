import "server-only";
import { prisma, type Tx } from "../db";
import { D, ZERO, dec } from "@/domain/money";
import { requiresPrint } from "@/domain/pricing/engine";
import type { LineResult } from "@/domain/pricing/types";
import { checkJobTransition, type JobStatus } from "@/domain/status/other";
import { NotFoundError, ServiceError, audit, nextNumber } from "./common";
import { committedQuantity, syncOrderStatus } from "./orders";
import { deductFromSpool, spoolCostPerKg } from "./materials";
import type { StoredLineInput } from "./pricing-inputs";

const PRODUCTION_ORDER_STATUSES = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"];

function perUnitEstimates(item: { quantity: number; pricingInput: unknown; pricingResult: unknown }) {
  const stored = item.pricingInput as StoredLineInput;
  const r = item.pricingResult as LineResult | null;
  const minutes = stored?.print?.printMinutesPerUnit ? dec(stored.print.printMinutesPerUnit) : ZERO;
  const gramsTotal = r?.production ? dec(r.production.grams.total) : ZERO;
  return { minutesPerUnit: minutes, gramsPerUnit: item.quantity > 0 ? gramsTotal.div(item.quantity) : ZERO, unitsPerBatch: Math.max(1, stored?.print?.unitsPerBatch ?? 1) };
}

async function nextQueuePosition(tx: Tx, printerId: string | null) {
  const agg = await tx.printJob.aggregate({ where: { printerId, status: "QUEUED" }, _max: { queuePosition: true } });
  return (agg._max.queuePosition ?? 0) + 1;
}

/** Creates batch-sized jobs for all unscheduled units of an order's print items. */
export async function createJobsForOrder(userId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { jobItems: { include: { job: { select: { status: true } } } } } } } });
    if (!order) throw new NotFoundError("Order");
    if (!PRODUCTION_ORDER_STATUSES.includes(order.status)) throw new ServiceError("Jobs can be created once the order is queued for production.");
    const created: string[] = [];
    for (const item of order.items) {
      if (!requiresPrint(item.serviceType)) continue;
      let remaining = item.quantity - committedQuantity(item);
      if (remaining <= 0) continue;
      const est = perUnitEstimates(item);
      while (remaining > 0) {
        const units = Math.min(est.unitsPerBatch, remaining);
        remaining -= units;
        const number = await nextNumber(tx, "JOB");
        await tx.printJob.create({
          data: {
            number,
            orderId,
            printerId: item.printerId,
            materialId: item.materialId,
            status: "QUEUED",
            queuePosition: await nextQueuePosition(tx, item.printerId),
            estimatedMinutes: est.minutesPerUnit.times(units).toFixed(2),
            estimatedGrams: est.gramsPerUnit.times(units).toFixed(2),
            items: { create: [{ orderItemId: item.id, quantity: units }] },
          },
        });
        created.push(number);
      }
    }
    if (created.length === 0) throw new ServiceError("All units are already scheduled or finished.");
    await audit(tx, { userId, entityType: "ORDER", entityId: orderId, action: "JOBS", summary: `Created print job(s) ${created.join(", ")}` });
    return created;
  });
}

/** Custom job, e.g. a mixed plate with several items or a partial batch. */
export async function createCustomJob(
  userId: string,
  input: { orderId: string; printerId: string | null; items: { orderItemId: string; quantity: number }[]; estimatedMinutes: string | null; notes: string | null },
) {
  const items = input.items.filter((i) => i.quantity > 0);
  if (items.length === 0) throw new ServiceError("Choose at least one item and quantity.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { items: { include: { jobItems: { include: { job: { select: { status: true } } } } } } } });
    if (!PRODUCTION_ORDER_STATUSES.includes(order.status)) throw new ServiceError("Jobs can be created once the order is queued for production.");
    let minutes = ZERO;
    let grams = ZERO;
    let materialId: string | null = null;
    for (const req of items) {
      const item = order.items.find((i) => i.id === req.orderItemId);
      if (!item || !requiresPrint(item.serviceType)) throw new ServiceError("Invalid item for this order.");
      const left = item.quantity - committedQuantity(item);
      if (req.quantity > left) throw new ServiceError(`Only ${left} unit(s) of “${item.partName}” are unscheduled.`);
      const est = perUnitEstimates(item);
      minutes = minutes.plus(est.minutesPerUnit.times(req.quantity));
      grams = grams.plus(est.gramsPerUnit.times(req.quantity));
      materialId ??= item.materialId;
    }
    const number = await nextNumber(tx, "JOB");
    const job = await tx.printJob.create({
      data: {
        number,
        orderId: input.orderId,
        printerId: input.printerId,
        materialId,
        status: "QUEUED",
        queuePosition: await nextQueuePosition(tx, input.printerId),
        estimatedMinutes: input.estimatedMinutes ?? minutes.toFixed(2),
        estimatedGrams: grams.toFixed(2),
        notes: input.notes,
        items: { create: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
      },
    });
    await audit(tx, { userId, entityType: "ORDER", entityId: input.orderId, action: "JOBS", summary: `Created print job ${number}` });
    return job;
  });
}

async function lockJob(tx: Tx, jobId: string) {
  await tx.$queryRaw`SELECT id FROM "PrintJob" WHERE id = ${jobId} FOR UPDATE`;
  const job = await tx.printJob.findUnique({ where: { id: jobId }, include: { items: { include: { orderItem: true } }, order: { select: { id: true, number: true, status: true } } } });
  if (!job) throw new NotFoundError("Print job");
  return job;
}

function assertJob(from: string, to: JobStatus) {
  const errors = checkJobTransition(from as JobStatus, to);
  if (errors.length) throw new ServiceError(errors[0]);
}

async function refreshPrinterStatus(tx: Tx, printerId: string | null) {
  if (!printerId) return;
  const printer = await tx.printer.findUnique({ where: { id: printerId } });
  if (!printer || !["AVAILABLE", "PRINTING"].includes(printer.status)) return;
  const busy = await tx.printJob.count({ where: { printerId, status: "PRINTING" } });
  await tx.printer.update({ where: { id: printerId }, data: { status: busy > 0 ? "PRINTING" : "AVAILABLE" } });
}

async function afterJobChange(tx: Tx, userId: string, job: { orderId: string; printerId: string | null }, previousPrinterId?: string | null) {
  // Maintain completed-unit counters on items.
  const items = await tx.orderItem.findMany({ where: { orderId: job.orderId }, include: { jobItems: { include: { job: { select: { status: true } } } } } });
  for (const item of items) {
    const done = item.jobItems.filter((ji) => ji.job.status === "DONE").reduce((a, ji) => a + (ji.quantityGood ?? ji.quantity), 0);
    if (done !== item.quantityCompleted) await tx.orderItem.update({ where: { id: item.id }, data: { quantityCompleted: done } });
    if (done >= item.quantity) await tx.materialReservation.updateMany({ where: { orderItemId: item.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
  }
  await refreshPrinterStatus(tx, job.printerId);
  if (previousPrinterId && previousPrinterId !== job.printerId) await refreshPrinterStatus(tx, previousPrinterId);
  await syncOrderStatus(tx, userId, job.orderId);
}

export async function startJob(userId: string, jobId: string, printerId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    assertJob(job.status, "PRINTING");
    if (!PRODUCTION_ORDER_STATUSES.includes(job.order.status)) throw new ServiceError(`Order ${job.order.number} is not in production.`);
    const pid = printerId ?? job.printerId;
    if (!pid) throw new ServiceError("Choose a printer for this job.");
    const printer = await tx.printer.findUnique({ where: { id: pid } });
    if (!printer) throw new NotFoundError("Printer");
    if (["MAINTENANCE", "OFFLINE", "RETIRED"].includes(printer.status)) throw new ServiceError(`${printer.name} is ${printer.status.toLowerCase()}.`);
    const busy = await tx.printJob.findFirst({ where: { printerId: pid, status: "PRINTING", NOT: { id: jobId } }, select: { number: true } });
    if (busy) throw new ServiceError(`${printer.name} is already printing ${busy.number}.`);
    await tx.printJob.update({ where: { id: jobId }, data: { status: "PRINTING", printerId: pid, startedAt: new Date() } });
    await audit(tx, { userId, entityType: "ORDER", entityId: job.orderId, action: "JOB_START", summary: `Started ${job.number} on ${printer.name}` });
    await afterJobChange(tx, userId, { orderId: job.orderId, printerId: pid }, job.printerId);
  });
}

export async function undoStart(userId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    assertJob(job.status, "QUEUED");
    await tx.printJob.update({ where: { id: jobId }, data: { status: "QUEUED", startedAt: null } });
    await audit(tx, { userId, entityType: "ORDER", entityId: job.orderId, action: "JOB_UNDO", summary: `${job.number} moved back to queue` });
    await afterJobChange(tx, userId, job);
  });
}

export interface ConsumptionInput {
  spoolId: string | null;
  materialId: string | null;
  grams: string;
}

/**
 * Records filament usage for a job: deducts spools atomically, writes ledger rows and
 * reduces the items' reservations (failed prints do not reduce reservations — the reprint still needs them).
 */
async function recordConsumption(tx: Tx, userId: string, job: Awaited<ReturnType<typeof lockJob>>, consumption: ConsumptionInput[], failed: boolean) {
  let total = ZERO;
  for (const c of consumption) {
    const grams = dec(c.grams);
    if (grams.lte(0)) continue;
    total = total.plus(grams);
    let materialId = c.materialId;
    let costPerKg: string | null = null;
    if (c.spoolId) {
      const spool = await tx.spool.findUnique({ where: { id: c.spoolId } });
      if (!spool) throw new NotFoundError("Spool");
      materialId = spool.materialId;
      costPerKg = spoolCostPerKg(spool);
      await deductFromSpool(tx, c.spoolId, grams);
    }
    if (!materialId) throw new ServiceError("Each usage line needs a spool or a material.");
    if (!costPerKg) {
      const m = await tx.material.findUnique({ where: { id: materialId }, select: { pricePerKg: true } });
      costPerKg = m?.pricePerKg?.toString() ?? null;
    }
    await tx.stockMovement.create({
      data: {
        materialId,
        spoolId: c.spoolId,
        type: failed ? "FAILED_PRINT" : "CONSUMED",
        quantityG: grams.neg().toFixed(2),
        costPerKg,
        printJobId: job.id,
        orderItemId: job.items[0]?.orderItemId ?? null,
        reason: `${job.number}${failed ? " (failed)" : ""}`,
        createdById: userId,
      },
    });
    if (!failed) {
      // Allocate against reservations of this material, proportionally to planned units.
      const planned = job.items.reduce((a, i) => a + i.quantity, 0) || 1;
      for (const ji of job.items) {
        const share = grams.times(ji.quantity).div(planned);
        const res = await tx.materialReservation.findUnique({ where: { orderItemId_materialId: { orderItemId: ji.orderItemId, materialId } } });
        if (res && res.status === "ACTIVE") {
          const consumed = dec(res.consumedG.toString()).plus(share);
          await tx.materialReservation.update({ where: { id: res.id }, data: { consumedG: consumed.toFixed(2), status: consumed.gte(dec(res.quantityG.toString())) ? "CONSUMED" : "ACTIVE" } });
        }
      }
    }
  }
  return total;
}

export interface FinishInput {
  outcome: "POST_PROCESSING" | "QUALITY_CHECK" | "DONE" | "FAILED";
  actualMinutes: string | null;
  consumption: ConsumptionInput[];
  /** For DONE: good units per job item (defaults to planned). */
  good: Record<string, number>;
  failureReason: string | null;
  notes: string | null;
}

/** PRINTING → post-processing / QC / done / failed, recording actual time and material. */
export async function finishPrint(userId: string, jobId: string, input: FinishInput) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "PRINTING") throw new ServiceError("Only a printing job can be finished.");
    assertJob(job.status, input.outcome);
    if (input.outcome === "FAILED" && (!input.failureReason || input.failureReason.trim().length < 3)) throw new ServiceError("Describe why the print failed.");
    const minutes = input.actualMinutes ? dec(input.actualMinutes) : job.startedAt ? new D(Math.max(1, Math.round((Date.now() - job.startedAt.getTime()) / 60000))) : null;
    const grams = await recordConsumption(tx, userId, job, input.consumption, input.outcome === "FAILED");
    if (input.outcome === "DONE") await setGood(tx, job, input.good);
    await tx.printJob.update({
      where: { id: jobId },
      data: {
        status: input.outcome,
        printedAt: new Date(),
        completedAt: input.outcome === "DONE" || input.outcome === "FAILED" ? new Date() : null,
        actualMinutes: minutes?.toFixed(2) ?? null,
        actualGrams: grams.toFixed(2),
        failureReason: input.outcome === "FAILED" ? input.failureReason : null,
        notes: input.notes ?? job.notes,
      },
    });
    await audit(tx, {
      userId,
      entityType: "ORDER",
      entityId: job.orderId,
      action: "JOB_FINISH",
      summary: `${job.number} → ${input.outcome.toLowerCase().replace("_", " ")} (${grams.toFixed(0)} g${minutes ? `, ${minutes.toFixed(0)} min` : ""})${input.failureReason ? `: ${input.failureReason}` : ""}`,
    });
    await afterJobChange(tx, userId, job);
  });
}

async function setGood(tx: Tx, job: Awaited<ReturnType<typeof lockJob>>, good: Record<string, number>) {
  for (const ji of job.items) {
    const g = good[ji.id] ?? ji.quantity;
    if (!Number.isInteger(g) || g < 0 || g > ji.quantity) throw new ServiceError(`Good units for “${ji.orderItem.partName}” must be between 0 and ${ji.quantity}.`);
    await tx.printJobItem.update({ where: { id: ji.id }, data: { quantityGood: g } });
  }
}

/** Post-processing / QC steps after printing. */
export async function advanceJob(
  userId: string,
  jobId: string,
  to: "QUALITY_CHECK" | "POST_PROCESSING" | "DONE" | "FAILED",
  opts: { good?: Record<string, number>; qcNotes?: string | null; failureReason?: string | null } = {},
) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status === "PRINTING") throw new ServiceError("Finish the print first (record time and material).");
    assertJob(job.status, to);
    if (to === "FAILED" && (!opts.failureReason || opts.failureReason.trim().length < 3)) throw new ServiceError("Describe why the parts were rejected.");
    if (to === "DONE") await setGood(tx, job, opts.good ?? {});
    if (to === "FAILED") for (const ji of job.items) await tx.printJobItem.update({ where: { id: ji.id }, data: { quantityGood: 0 } });
    await tx.printJob.update({
      where: { id: jobId },
      data: {
        status: to,
        completedAt: to === "DONE" || to === "FAILED" ? new Date() : null,
        qcNotes: opts.qcNotes ?? job.qcNotes,
        failureReason: to === "FAILED" ? opts.failureReason : job.failureReason,
      },
    });
    await audit(tx, {
      userId,
      entityType: "ORDER",
      entityId: job.orderId,
      action: "JOB_STEP",
      summary: `${job.number} → ${to.toLowerCase().replace("_", " ")}${opts.failureReason ? `: ${opts.failureReason}` : ""}`,
    });
    await afterJobChange(tx, userId, job);
  });
}

export async function cancelJob(userId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    assertJob(job.status, "CANCELED");
    await tx.printJob.update({ where: { id: jobId }, data: { status: "CANCELED" } });
    await audit(tx, { userId, entityType: "ORDER", entityId: job.orderId, action: "JOB_CANCEL", summary: `Canceled ${job.number}` });
    await afterJobChange(tx, userId, job);
  });
}

/** Queues a reprint for units that failed (whole failed job, or rejected units of a done job). */
export async function reprintJob(userId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!["FAILED", "DONE"].includes(job.status)) throw new ServiceError("Only failed or completed jobs can be reprinted.");
    const lines = job.items
      .map((ji) => ({ orderItemId: ji.orderItemId, quantity: job.status === "FAILED" ? ji.quantity : ji.quantity - (ji.quantityGood ?? ji.quantity) }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) throw new ServiceError("Nothing to reprint — all units passed.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: job.orderId } });
    if (!PRODUCTION_ORDER_STATUSES.includes(order.status)) throw new ServiceError(`Order ${order.number} is not in production.`);
    const planned = job.items.reduce((a, i) => a + i.quantity, 0) || 1;
    const units = lines.reduce((a, l) => a + l.quantity, 0);
    const number = await nextNumber(tx, "JOB");
    const re = await tx.printJob.create({
      data: {
        number,
        orderId: job.orderId,
        printerId: job.printerId,
        materialId: job.materialId,
        status: "QUEUED",
        queuePosition: await nextQueuePosition(tx, job.printerId),
        estimatedMinutes: job.estimatedMinutes ? dec(job.estimatedMinutes.toString()).times(units).div(planned).toFixed(2) : null,
        estimatedGrams: job.estimatedGrams ? dec(job.estimatedGrams.toString()).times(units).div(planned).toFixed(2) : null,
        reprintOfId: job.id,
        items: { create: lines },
      },
    });
    await audit(tx, { userId, entityType: "ORDER", entityId: job.orderId, action: "REPRINT", summary: `Reprint ${number} for ${job.number} (${units} unit(s))` });
    await afterJobChange(tx, userId, job);
    return re;
  });
}

export async function assignJob(userId: string, jobId: string, printerId: string | null, plannedStart: Date | null) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (job.status !== "QUEUED") throw new ServiceError("Only queued jobs can be reassigned.");
    await tx.printJob.update({ where: { id: jobId }, data: { printerId, plannedStart, queuePosition: printerId !== job.printerId ? await nextQueuePosition(tx, printerId) : job.queuePosition } });
    await audit(tx, { userId, entityType: "ORDER", entityId: job.orderId, action: "JOB_ASSIGN", summary: `${job.number} assigned${printerId ? "" : " (unassigned)"}` });
  });
}

/** Moves a queued job up/down within its printer queue. */
export async function reorderJob(jobId: string, direction: "up" | "down") {
  return prisma.$transaction(async (tx) => {
    const job = await tx.printJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "QUEUED") return;
    const neighbor = await tx.printJob.findFirst({
      where: { printerId: job.printerId, status: "QUEUED", queuePosition: direction === "up" ? { lt: job.queuePosition } : { gt: job.queuePosition } },
      orderBy: { queuePosition: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbor) return;
    await tx.printJob.update({ where: { id: job.id }, data: { queuePosition: neighbor.queuePosition } });
    await tx.printJob.update({ where: { id: neighbor.id }, data: { queuePosition: job.queuePosition } });
  });
}

export async function productionBoard() {
  const since = new Date(Date.now() - 7 * 86400000);
  const [jobs, printers] = await Promise.all([
    prisma.printJob.findMany({
      where: { OR: [{ status: { in: ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"] } }, { status: { in: ["DONE", "FAILED"] }, updatedAt: { gte: since } }] },
      orderBy: [{ queuePosition: "asc" }, { createdAt: "asc" }],
      include: {
        printer: { select: { id: true, name: true } },
        material: { select: { id: true, brand: true, colorName: true, colorHex: true, materialType: { select: { code: true } } } },
        order: { select: { id: true, number: true, dueDate: true, priority: true, customer: { select: { name: true } } } },
        items: { include: { orderItem: { select: { partName: true, materialId: true } } } },
        reprints: { select: { id: true } },
      },
    }),
    prisma.printer.findMany({ where: { status: { not: "RETIRED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, model: true } }),
  ]);
  return { jobs, printers };
}

/** Spools of a material that can supply a job (for the finish dialog). */
export async function spoolOptions(materialIds: string[]) {
  return prisma.spool.findMany({
    where: { materialId: { in: materialIds }, status: { in: ["SEALED", "OPEN"] } },
    orderBy: [{ status: "desc" }, { remainingG: "asc" }],
    select: {
      id: true,
      code: true,
      remainingG: true,
      remainingIsMeasured: true,
      status: true,
      materialId: true,
      material: { select: { brand: true, colorName: true, materialType: { select: { code: true } } } },
    },
  });
}
