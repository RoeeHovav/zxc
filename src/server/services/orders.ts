import "server-only";
import { prisma, type Tx } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { D, ZERO, dec, roundMoney } from "@/domain/money";
import { machineRateBreakdown, requiresModeling, requiresPrint, requiresScanning } from "@/domain/pricing/engine";
import type { LineResult, PricingContext } from "@/domain/pricing/types";
import { EDITABLE_ORDER_STATUSES, canForceTransition, checkOrderTransition, statusAfterConfirm, syncProductionStatus, type OrderFacts, type OrderStatus } from "@/domain/status/order";
import type { OrderForm } from "@/domain/schemas/sales";
import { NotFoundError, ServiceError, audit, idempotent, nextNumber } from "./common";
import { lineColumns, type StoredLineInput } from "./pricing-inputs";
import { priceDocument, totalsColumns } from "./documents";
import { getSettings } from "./settings";
import { toResolvedPrinter } from "./printers";

type ItemWithJobs = { id: string; quantity: number; serviceType: string; materialId: string | null; jobItems: { quantity: number; quantityGood: number | null; job: { status: string } }[] };

const PRINTED_STATUSES = ["POST_PROCESSING", "QUALITY_CHECK"];
const OPEN_JOB = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"];

/** Units scheduled or produced for an item (jobs not failed/canceled). Used for edit guards and job creation. */
export function committedQuantity(item: ItemWithJobs) {
  return item.jobItems.reduce((a, ji) => a + (OPEN_JOB.includes(ji.job.status) ? ji.quantity : ji.job.status === "DONE" ? (ji.quantityGood ?? ji.quantity) : 0), 0);
}

/** Loads the facts the order state machine needs, straight from the database. */
export async function orderFacts(tx: Tx | typeof prisma, orderId: string): Promise<OrderFacts> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { designProject: { select: { status: true } }, jobItems: { include: { job: { select: { status: true } } } } } },
      jobs: { select: { number: true, status: true } },
    },
  });
  const settings = await getSettings(tx);
  if (!order) throw new NotFoundError("Order");
  return {
    status: order.status as OrderStatus,
    total: order.total.toString(),
    amountPaid: order.amountPaid.toString(),
    depositAmount: order.depositAmount.toString(),
    requireDepositToProduce: settings.requireDepositToProduce,
    items: order.items.map((i) => {
      const stored = i.pricingInput as unknown as StoredLineInput;
      const done = i.jobItems.filter((ji) => ji.job.status === "DONE").reduce((a, ji) => a + (ji.quantityGood ?? ji.quantity), 0);
      const inFinishing = i.jobItems.filter((ji) => PRINTED_STATUSES.includes(ji.job.status)).reduce((a, ji) => a + ji.quantity, 0);
      return {
        partName: i.partName,
        serviceType: i.serviceType,
        quantity: i.quantity,
        quantityCompleted: done,
        quantityPrinted: done + inFinishing,
        designStatus: (i.designProject?.status as OrderFacts["items"][number]["designStatus"]) ?? null,
        designFeeWaived: !!stored?.modeling?.waived,
      };
    }),
    jobs: order.jobs,
  };
}

/** Grams to reserve per material for one item, from its pricing result. */
function requiredGrams(item: { serviceType: string; materialId: string | null; supportMaterialId: string | null; pricingResult: unknown }): Map<string, InstanceType<typeof D>> {
  const map = new Map<string, InstanceType<typeof D>>();
  if (!requiresPrint(item.serviceType) || !item.materialId) return map;
  const r = item.pricingResult as LineResult | null;
  const g = r?.production?.grams;
  if (!g) return map;
  const add = (id: string, v: string) => map.set(id, (map.get(id) ?? ZERO).plus(dec(v)));
  add(item.materialId, g.primaryTotal ?? g.total);
  if (g.supportTotal && dec(g.supportTotal).gt(0)) add(item.supportMaterialId ?? item.materialId, g.supportTotal);
  return map;
}

/** Makes reservations match the current items of an active order. */
export async function syncReservations(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { reservations: true } });
  for (const item of items) {
    const need = requiredGrams(item);
    for (const r of item.reservations) {
      if (!need.has(r.materialId) && r.status === "ACTIVE") await tx.materialReservation.update({ where: { id: r.id }, data: { status: "RELEASED" } });
    }
    for (const [materialId, grams] of need) {
      const existing = item.reservations.find((r) => r.materialId === materialId);
      if (existing) {
        const consumed = dec(existing.consumedG.toString());
        await tx.materialReservation.update({ where: { id: existing.id }, data: { quantityG: grams.toFixed(2), status: consumed.gte(grams) ? "CONSUMED" : "ACTIVE" } });
      } else {
        await tx.materialReservation.create({ data: { materialId, orderItemId: item.id, quantityG: grams.toFixed(2) } });
      }
    }
  }
}

export async function releaseReservations(tx: Tx, orderId: string) {
  await tx.materialReservation.updateMany({ where: { orderItem: { orderId }, status: "ACTIVE" }, data: { status: "RELEASED" } });
}

async function ensureDesignProjects(tx: Tx, userId: string, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const settings = await getSettings(tx);
  for (const item of order.items) {
    const needsDesign = requiresModeling(item.serviceType) || requiresScanning(item.serviceType);
    const stored = item.pricingInput as unknown as StoredLineInput;
    if (!needsDesign || item.designProjectId || stored?.modeling?.waived) continue;
    const number = await nextNumber(tx, "DESIGN");
    const modeling = stored?.modeling;
    const type = requiresScanning(item.serviceType) ? (requiresModeling(item.serviceType) || stored?.scanning?.reverseEngineeringHours ? "SCAN_TO_CAD" : "SCANNING") : "MODELING";
    const est = modeling?.hours
      ? dec(modeling.hours)
      : stored?.scanning
        ? dec(stored.scanning.scanHours ?? "0")
            .plus(dec(stored.scanning.cleanupHours ?? "0"))
            .plus(dec(stored.scanning.reverseEngineeringHours ?? "0"))
        : null;
    const project = await tx.designProject.create({
      data: {
        number,
        customerId: order.customerId,
        title: item.partName,
        description: item.description,
        type,
        status: "REQUESTED",
        estimatedHours: est ? est.toFixed(2) : null,
        feeMode: modeling?.mode ?? "HOURLY",
        fixedFee: modeling?.mode === "FIXED" ? modeling.fixedFee : null,
        hourlyRate: settings.modelingRatePerHour,
        dueDate: item.deadline ?? order.dueDate,
        defaultMaterialId: item.materialId,
        defaultPrinterId: item.printerId,
        defaultGramsPerUnit: stored?.print?.gramsPerUnit ?? null,
        defaultSupportGrams: stored?.print?.supportGramsPerUnit ?? null,
        defaultPrintMinutes: stored?.print?.printMinutesPerUnit ?? null,
      },
    });
    await tx.orderItem.update({ where: { id: item.id }, data: { designProjectId: project.id } });
    await audit(tx, { userId, entityType: "DESIGN", entityId: project.id, action: "CREATE", summary: `Created ${number} from order ${order.number}` });
  }
}

/** DRAFT → first active status. Creates reservations and design projects. */
export async function confirmOrderTx(tx: Tx, userId: string, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { _count: { select: { items: true } } } });
  if (order.status !== "DRAFT") throw new ServiceError("This order is already confirmed.");
  if (order._count.items === 0) throw new ServiceError("Add at least one item before confirming.");
  if (!order.pricingComplete) throw new ServiceError("Resolve all pricing errors before confirming the order.");
  await ensureDesignProjects(tx, userId, orderId);
  await syncReservations(tx, orderId);
  const next = statusAfterConfirm(await orderFacts(tx, orderId));
  await tx.order.update({ where: { id: orderId }, data: { status: next, confirmedAt: new Date(), ...(next === "READY" ? { readyAt: new Date() } : {}) } });
  await audit(tx, { userId, entityType: "ORDER", entityId: orderId, action: "STATUS", summary: `Confirmed ${order.number} → ${next}`, details: { from: "DRAFT", to: next } });
  return next;
}

export async function createOrderFromQuote(tx: Tx, userId: string, quoteId: string) {
  const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: { orderBy: { position: "asc" } }, customer: true } });
  if (!quote.pricingComplete) throw new ServiceError("The quote has pricing errors and cannot be converted.");
  const number = await nextNumber(tx, "ORDER");
  const c = quote.customer;
  const address = [c.addressLine1, c.addressLine2, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const order = await tx.order.create({
    data: {
      number,
      customerId: quote.customerId,
      quoteId: quote.id,
      status: "DRAFT",
      title: quote.title,
      dueDate: quote.requestedBy,
      pricingPolicyId: quote.pricingPolicyId,
      currency: quote.currency,
      pricingContext: quote.pricingContext as Prisma.InputJsonValue,
      orderDiscountType: quote.orderDiscountType,
      orderDiscountValue: quote.orderDiscountValue,
      shippingMethod: quote.shippingMethod,
      shippingCharge: quote.shippingCharge,
      shippingCost: quote.shippingCost,
      deliveryAddress: address,
      deliveryMethod: dec(quote.shippingCharge.toString()).gt(0) ? "COURIER" : "PICKUP",
      depositPercent: quote.depositPercent,
      paymentTerms: quote.paymentTerms,
      customerNotes: quote.customerNotes,
      internalNotes: quote.internalNotes,
      pricingSummary: (quote.pricingSummary ?? undefined) as Prisma.InputJsonValue | undefined,
      pricingComplete: quote.pricingComplete,
      itemsNet: quote.itemsNet,
      orderDiscount: quote.orderDiscount,
      minimumAdjustment: quote.minimumAdjustment,
      taxableAmount: quote.taxableAmount,
      vatAmount: quote.vatAmount,
      total: quote.total,
      depositAmount: quote.depositAmount,
      estimatedCost: quote.estimatedCost,
      estimatedProfit: quote.estimatedProfit,
    },
  });
  for (const it of quote.items) {
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        position: it.position,
        serviceType: it.serviceType,
        partName: it.partName,
        description: it.description,
        category: it.category,
        quantity: it.quantity,
        materialId: it.materialId,
        supportMaterialId: it.supportMaterialId,
        printerId: it.printerId,
        designProjectId: it.designProjectId,
        colorNote: it.colorNote,
        deadline: it.deadline,
        specialInstructions: it.specialInstructions,
        pricingInput: it.pricingInput as Prisma.InputJsonValue,
        pricingResult: (it.pricingResult ?? undefined) as Prisma.InputJsonValue | undefined,
        unitPrice: it.unitPrice,
        lineNet: it.lineNet,
        lineCost: it.lineCost,
      },
    });
  }
  await audit(tx, { userId, entityType: "ORDER", entityId: order.id, action: "CREATE", summary: `Created ${number} from quote ${quote.number} rev ${quote.revision}` });
  await confirmOrderTx(tx, userId, order.id);
  return order;
}

export async function saveOrder(userId: string, id: string | null, form: OrderForm, clientKey?: string | null) {
  const save = () => prisma.$transaction((tx) => saveOrderTx(tx, userId, id, form, clientKey));
  return id ? save() : idempotent(clientKey, (key) => prisma.order.findUnique({ where: { clientKey: key } }), save);
}

/** Creates or updates an order inside the caller's transaction. */
export async function saveOrderTx(tx: Tx, userId: string, id: string | null, form: OrderForm, clientKey?: string | null) {
  if (id) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
  const customer = await tx.customer.findUnique({ where: { id: form.customerId } });
  if (!customer) throw new ServiceError("Select a customer.");
  if (customer.anonymizedAt) throw new ServiceError("This customer was anonymized and cannot receive new orders.");
  const existing = id ? await tx.order.findUnique({ where: { id }, include: { items: { include: { jobItems: { include: { job: { select: { status: true } } } } } } } }) : null;
  if (id && !existing) throw new NotFoundError("Order");
  if (existing && !EDITABLE_ORDER_STATUSES.includes(existing.status as OrderStatus))
    throw new ServiceError("Items can only be changed before printing starts. Cancel remaining jobs or create a new order for extra work.");
  if (!existing && customer.archivedAt) throw new ServiceError("This customer is archived. Restore them first.");
  if (existing && existing.customerId !== form.customerId && existing.status !== "DRAFT") throw new ServiceError("The customer of a confirmed order cannot be changed.");

  const confirmed = existing && existing.status !== "DRAFT";
  if (existing && confirmed) {
    const byId = new Map(form.lines.filter((l) => l.id).map((l) => [l.id!, l]));
    for (const item of existing.items) {
      const committed = committedQuantity(item);
      if (committed === 0) continue;
      const line = byId.get(item.id);
      if (!line) throw new ServiceError(`“${item.partName}” already has print jobs and cannot be removed. Cancel its jobs first.`);
      if (line.quantity < committed) throw new ServiceError(`“${item.partName}” has ${committed} unit(s) scheduled or made; quantity cannot go below that.`);
      if (line.materialId !== item.materialId || line.serviceType !== item.serviceType)
        throw new ServiceError(`“${item.partName}” already has print jobs; its service and material cannot be changed.`);
    }
  }

  const { ctx, stored, result } = await priceDocument(tx, form, customer.vatExempt, existing);
  if (confirmed && !result.complete) throw new ServiceError("A confirmed order must stay fully priced. Resolve the pricing errors first.");
  const settings = await getSettings(tx);
  const header = {
    customerId: customer.id,
    title: form.title,
    dueDate: form.dueDate,
    priority: form.priority,
    deliveryMethod: form.deliveryMethod,
    deliveryAddress: form.deliveryAddress,
    pricingPolicyId: ctx.policy.id,
    currency: ctx.currency,
    pricingContext: JSON.parse(JSON.stringify(ctx)),
    orderDiscountType: form.orderDiscountType,
    orderDiscountValue: form.orderDiscountValue,
    shippingMethod: form.shippingMethod,
    shippingCharge: form.shippingCharge ?? "0",
    shippingCost: form.shippingCost ?? "0",
    depositPercent: form.depositPercent,
    paymentTerms: form.paymentTerms ?? (existing ? null : settings.defaultPaymentTerms),
    customerNotes: form.customerNotes,
    internalNotes: form.internalNotes,
    ...totalsColumns(result),
  };

  let order;
  if (existing) {
    order = await tx.order.update({ where: { id: existing.id }, data: { ...header, revision: confirmed ? { increment: 1 } : undefined } });
    const keep = new Set(form.lines.map((l) => l.id).filter(Boolean) as string[]);
    const removed = existing.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (removed.length) await tx.orderItem.deleteMany({ where: { id: { in: removed }, orderId: existing.id } });
    const existingIds = new Set(existing.items.map((i) => i.id));
    for (let i = 0; i < form.lines.length; i++) {
      const l = form.lines[i];
      const data = lineColumns(l, i, stored[i], result.lines[i]);
      if (l.id && existingIds.has(l.id)) await tx.orderItem.update({ where: { id: l.id }, data: data as Prisma.OrderItemUncheckedUpdateInput });
      else await tx.orderItem.create({ data: { ...(data as Prisma.OrderItemUncheckedCreateInput), orderId: existing.id } });
    }
    if (confirmed) {
      await ensureDesignProjects(tx, userId, existing.id);
      await syncReservations(tx, existing.id);
      await audit(tx, {
        userId,
        entityType: "ORDER",
        entityId: existing.id,
        action: "REVISE",
        summary: `Revised ${existing.number} (rev ${order.revision}): total ${existing.total.toString()} → ${order.total.toString()}`,
        details: { before: { total: existing.total.toString(), items: existing.items.map((i) => ({ part: i.partName, qty: i.quantity, net: i.lineNet?.toString() ?? null })) } },
      });
    } else await audit(tx, { userId, entityType: "ORDER", entityId: existing.id, action: "UPDATE", summary: `Updated draft ${existing.number}` });
  } else {
    const number = await nextNumber(tx, "ORDER");
    order = await tx.order.create({ data: { ...header, number, status: "DRAFT", clientKey: clientKey ?? null } });
    for (let i = 0; i < form.lines.length; i++) await tx.orderItem.create({ data: { ...lineColumns(form.lines[i], i, stored[i], result.lines[i]), orderId: order.id } });
    await audit(tx, { userId, entityType: "ORDER", entityId: order.id, action: "CREATE", summary: `Created order ${number} for ${customer.name}` });
  }
  if (form.confirm && order.status === "DRAFT") await confirmOrderTx(tx, userId, order.id);
  return order;
}

export async function transitionOrder(userId: string, id: string, to: OrderStatus, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order");
    if (order.status === "DRAFT" && to !== "CANCELED") return { status: await confirmOrderTx(tx, userId, id), forced: false };
    const facts = await orderFacts(tx, id);
    const check = checkOrderTransition(facts, to);
    if (!check.ok && !canForceTransition(check, reason)) {
      const overridable = check.failures.every((f) => f.overridable);
      throw new ServiceError(check.failures.map((f) => f.message).join(" ") + (overridable ? " You can override this with a reason." : ""), { overridable });
    }
    const now = new Date();
    const data: Prisma.OrderUncheckedUpdateInput = { status: to };
    if (to === "CANCELED") {
      await releaseReservations(tx, id);
      await tx.printJob.updateMany({ where: { orderId: id, status: "QUEUED" }, data: { status: "CANCELED" } });
      data.canceledAt = now;
      data.cancelReason = reason ?? null;
    }
    if (to === "READY") data.readyAt = now;
    if (to === "DELIVERED") {
      data.deliveredAt = now;
      if (!order.deliveryNoteNumber) data.deliveryNoteNumber = await nextNumber(tx, "DELIVERY");
    }
    if (to === "COMPLETED") {
      data.completedAt = now;
      data.actualCost = (await computeActualCost(tx, id)).total;
      await tx.materialReservation.updateMany({ where: { orderItem: { orderId: id }, status: "ACTIVE" }, data: { status: "RELEASED" } });
    }
    await tx.order.update({ where: { id }, data });
    await audit(tx, {
      userId,
      entityType: "ORDER",
      entityId: id,
      action: "STATUS",
      summary: `${order.number}: ${order.status} → ${to}${!check.ok ? " (override)" : ""}${reason ? ` — ${reason}` : ""}`,
      details: { from: order.status, to, reason: reason ?? null, forced: !check.ok, failures: check.ok ? [] : check.failures.map((f) => f.message) },
    });
    return { status: to, forced: !check.ok };
  });
}

/** Applies job-derived production status (called after every job event and payment). */
export async function syncOrderStatus(tx: Tx, userId: string | null, orderId: string) {
  const facts = await orderFacts(tx, orderId);
  let target = syncProductionStatus(facts);
  // A received deposit releases an order waiting for payment.
  if (!target && facts.status === "AWAITING_PAYMENT") {
    const next = statusAfterConfirm({ ...facts, status: "DRAFT" });
    if (next !== "AWAITING_PAYMENT") target = next;
  }
  if (!target) return null;
  await tx.order.update({ where: { id: orderId }, data: { status: target, ...(target === "READY" ? { readyAt: new Date() } : {}) } });
  await audit(tx, {
    userId,
    entityType: "ORDER",
    entityId: orderId,
    action: "STATUS",
    summary: `Automatically moved ${facts.status} → ${target}`,
    details: { from: facts.status, to: target, automatic: true },
  });
  return target;
}

export interface ActualCost {
  material: string;
  machine: string;
  labor: string;
  services: string;
  extras: string;
  shipping: string;
  packing: string;
  fees: string;
  total: string;
  /** False while production data is incomplete (e.g. jobs without recorded consumption). */
  complete: boolean;
}

/**
 * Actual cost from recorded reality: consumed/wasted material at spool cost, actual machine
 * time at the printer's rate, logged design time, real payment fees. Labor for setup and
 * post-processing is not time-tracked, so its estimate is used.
 */
export async function computeActualCost(tx: Tx | typeof prisma, orderId: string): Promise<ActualCost> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { include: { designProject: { include: { timeEntries: true } } } },
      jobs: { include: { printer: true, movements: { include: { material: true } } } },
      payments: { where: { voidedAt: null } },
    },
  });
  const ctx = order.pricingContext as unknown as PricingContext;
  const settings = await getSettings(tx);
  let material = ZERO;
  let machine = ZERO;
  let complete = true;
  for (const job of order.jobs) {
    if (!["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"].includes(job.status)) continue;
    for (const mv of job.movements) {
      const perKg = mv.costPerKg ? dec(mv.costPerKg.toString()) : mv.material.pricePerKg ? dec(mv.material.pricePerKg.toString()) : null;
      if (!perKg) complete = false;
      else material = material.plus(dec(mv.quantityG.toString()).neg().div(1000).times(perKg));
    }
    if (job.movements.length === 0) complete = false;
    if (job.actualMinutes) {
      const rate = machineRateBreakdown(job.printer ? toResolvedPrinter(job.printer) : null, dec(ctx.rates.electricityTariffPerKwh), dec(ctx.rates.defaultMachineCostPerHour)).rate;
      machine = machine.plus(dec(job.actualMinutes.toString()).div(60).times(rate));
    } else complete = false;
  }
  let labor = ZERO;
  let services = ZERO;
  let extras = ZERO;
  const laborRate = dec(ctx.rates.laborCostPerHour);
  const scannerRate = dec(ctx.rates.scannerCostPerHour);
  for (const item of order.items) {
    const r = item.pricingResult as LineResult | null;
    if (r?.production) {
      labor = labor.plus(dec(r.production.costs.setupLabor)).plus(dec(r.production.costs.postProcessingLabor));
      extras = extras.plus(dec(r.production.costs.extras));
    }
    const entries = item.designProject?.timeEntries ?? [];
    if (entries.length) {
      for (const e of entries) {
        services = services.plus(dec(e.hours.toString()).times(laborRate));
        if (e.category === "SCANNING") services = services.plus(dec(e.hours.toString()).times(scannerRate));
      }
    } else if (r?.services) services = services.plus(dec(r.services.cost));
  }
  const hasPrint = order.items.some((i) => requiresPrint(i.serviceType));
  const packing = hasPrint ? dec(ctx.rates.packingCostPerOrder) : ZERO;
  const fees = order.payments.reduce((a, p) => a.plus(dec(p.feeAmount.toString())), ZERO);
  const shipping = dec(order.shippingCost.toString());
  const total = [material, machine, labor, services, extras, shipping, packing, fees].reduce((a, b) => a.plus(b), ZERO);
  void settings;
  const m = (v: InstanceType<typeof D>) => roundMoney(v).toFixed(2);
  return {
    material: m(material),
    machine: m(machine),
    labor: m(labor),
    services: m(services),
    extras: m(extras),
    shipping: m(shipping),
    packing: m(packing),
    fees: m(fees),
    total: m(total),
    complete,
  };
}

export async function listOrders(opts: { q?: string; view?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.OrderWhereInput = {};
  const view = opts.view ?? "active";
  if (view === "active") where.status = { notIn: ["COMPLETED", "CANCELED"] };
  else if (view === "draft") where.status = "DRAFT";
  else if (view === "production") where.status = { in: ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"] };
  else if (view === "waiting") where.status = { in: ["AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL"] };
  else if (view === "ready") where.status = { in: ["READY", "DELIVERED"] };
  else if (view === "overdue") where.AND = [{ status: { notIn: ["COMPLETED", "CANCELED", "DELIVERED", "DRAFT"] } }, { dueDate: { lt: new Date() } }];
  else if (view === "done") where.status = { in: ["COMPLETED", "CANCELED"] };
  const q = opts.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ number: ci }, { title: ci }, { customer: { name: ci } }, { customer: { company: ci } }, { items: { some: { partName: ci } } }];
  }
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: view === "active" || view === "overdue" ? [{ dueDate: { sort: "asc", nulls: "last" } }, { orderDate: "desc" }] : { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        items: { select: { quantity: true, quantityCompleted: true, serviceType: true, partName: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      quote: { select: { id: true, number: true, revision: true } },
      items: {
        orderBy: { position: "asc" },
        include: {
          material: { select: { id: true, colorHex: true, brand: true, colorName: true } },
          printer: { select: { id: true, name: true } },
          designProject: { select: { id: true, number: true, title: true, status: true } },
          jobItems: { include: { job: { select: { id: true, number: true, status: true } } } },
          reservations: true,
          files: { orderBy: { createdAt: "desc" } },
        },
      },
      jobs: { orderBy: { createdAt: "asc" }, include: { printer: { select: { name: true } }, items: { include: { orderItem: { select: { partName: true } } } } } },
      payments: { orderBy: { receivedAt: "asc" } },
      files: { orderBy: { createdAt: "desc" } },
      pricingPolicy: { select: { name: true } },
    },
  });
}

export async function orderTimeline(id: string) {
  return prisma.auditLog.findMany({ where: { entityType: "ORDER", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true } } } });
}
