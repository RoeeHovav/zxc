import "server-only";
import { prisma } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { ZERO, dec } from "@/domain/money";
import { checkDesignTransition, isRevisionChargeable, type DesignStatus } from "@/domain/status/other";
import { NotFoundError, ServiceError, audit, nextNumber } from "./common";
import { getSettings } from "./settings";
import { saveOrderTx, syncOrderStatus } from "./orders";
import type { OrderForm } from "@/domain/schemas/sales";

export interface DesignInput {
  customerId: string;
  title: string;
  description: string | null;
  type: "MODELING" | "SCANNING" | "SCAN_TO_CAD";
  complexity: "SIMPLE" | "MODERATE" | "COMPLEX" | "EXPERT";
  estimatedHours: string | null;
  includedRevisions: number | null;
  feeMode: "HOURLY" | "FIXED";
  fixedFee: string | null;
  hourlyRate: string | null;
  additionalRevisionFee: string | null;
  ownership: "CUSTOMER" | "BUSINESS" | "SHARED";
  licenseNotes: string | null;
  dueDate: Date | null;
  defaultMaterialId: string | null;
  defaultPrinterId: string | null;
  defaultGramsPerUnit: string | null;
  defaultSupportGrams: string | null;
  defaultPrintMinutes: string | null;
}

export async function saveDesign(userId: string, id: string | null, input: DesignInput) {
  const settings = await getSettings();
  const data = { ...input, includedRevisions: input.includedRevisions ?? 2, hourlyRate: input.hourlyRate ?? settings.modelingRatePerHour.toString() };
  return prisma.$transaction(async (tx) => {
    if (id) {
      const d = await tx.designProject.update({ where: { id }, data });
      await audit(tx, { userId, entityType: "DESIGN", entityId: id, action: "UPDATE", summary: `Updated ${d.number}` });
      return d;
    }
    const number = await nextNumber(tx, "DESIGN");
    const d = await tx.designProject.create({ data: { ...data, number } });
    await audit(tx, { userId, entityType: "DESIGN", entityId: d.id, action: "CREATE", summary: `Created ${number} ${d.title}` });
    return d;
  });
}

export async function listDesigns(opts: { q?: string; status?: string; type?: string }) {
  const where: Prisma.DesignProjectWhereInput = {};
  if (opts.status === "open") where.status = { in: ["REQUESTED", "IN_PROGRESS", "AWAITING_APPROVAL", "REVISION_REQUESTED"] };
  else if (opts.status === "library") where.status = { in: ["APPROVED", "DELIVERED"] };
  else if (opts.status && opts.status !== "all") where.status = opts.status as DesignStatus;
  if (opts.type) where.type = opts.type as DesignInput["type"];
  if (opts.q) {
    const ci = { contains: opts.q, mode: "insensitive" as const };
    where.OR = [{ number: ci }, { title: ci }, { customer: { name: ci } }, { description: ci }];
  }
  const rows = await prisma.designProject.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: { customer: { select: { id: true, name: true } }, timeEntries: { select: { hours: true } }, _count: { select: { orderItems: true, revisions: true, files: true } } },
  });
  return rows.map((r) => ({ ...r, loggedHours: r.timeEntries.reduce((a, t) => a.plus(dec(t.hours.toString())), ZERO).toFixed(2) }));
}

export async function getDesign(id: string) {
  const d = await prisma.designProject.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, number: true } },
      timeEntries: { orderBy: { date: "desc" } },
      revisions: { orderBy: { number: "desc" } },
      files: { orderBy: { createdAt: "desc" } },
      defaultMaterial: { select: { id: true, brand: true, colorName: true, materialType: { select: { code: true } } } },
      defaultPrinter: { select: { id: true, name: true } },
      orderItems: { include: { order: { select: { id: true, number: true, status: true, orderDate: true } } } },
    },
  });
  if (!d) return null;
  const byCategory: Record<string, string> = {};
  let total = ZERO;
  let billable = ZERO;
  for (const t of d.timeEntries) {
    const h = dec(t.hours.toString());
    byCategory[t.category] = dec(byCategory[t.category] ?? "0")
      .plus(h)
      .toFixed(2);
    total = total.plus(h);
    if (t.billable) billable = billable.plus(h);
  }
  const est = d.estimatedHours ? dec(d.estimatedHours.toString()) : null;
  return { design: d, hours: { byCategory, total: total.toFixed(2), billable: billable.toFixed(2), variance: est ? total.minus(est).toFixed(2) : null } };
}

export async function transitionDesign(userId: string, id: string, to: DesignStatus, note: string | null) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.designProject.findUnique({ where: { id }, include: { orderItems: { select: { orderId: true } } } });
    if (!d) throw new NotFoundError("Design project");
    const errors = checkDesignTransition(d.status as DesignStatus, to);
    if (errors.length) throw new ServiceError(errors[0]);
    const data: Prisma.DesignProjectUpdateInput = { status: to };
    if (to === "APPROVED") {
      data.approvedAt = new Date();
      data.approvalNote = note;
    }
    if (to === "DELIVERED") data.deliveredAt = new Date();
    await tx.designProject.update({ where: { id }, data });
    await audit(tx, { userId, entityType: "DESIGN", entityId: id, action: "STATUS", summary: `${d.number}: ${d.status} → ${to}${note ? ` — ${note}` : ""}` });
    // Linked orders waiting on this design may now advance.
    for (const orderId of new Set(d.orderItems.map((i) => i.orderId))) {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (order && to === "AWAITING_APPROVAL" && order.status === "AWAITING_MODELING") {
        await tx.order.update({ where: { id: orderId }, data: { status: "AWAITING_APPROVAL" } });
        await audit(tx, {
          userId: null,
          entityType: "ORDER",
          entityId: orderId,
          action: "STATUS",
          summary: `Automatically moved AWAITING_MODELING → AWAITING_APPROVAL (${d.number} sent for approval)`,
        });
      } else if (order && to === "REVISION_REQUESTED" && order.status === "AWAITING_APPROVAL") {
        await tx.order.update({ where: { id: orderId }, data: { status: "AWAITING_MODELING" } });
        await audit(tx, {
          userId: null,
          entityType: "ORDER",
          entityId: orderId,
          action: "STATUS",
          summary: `Automatically moved AWAITING_APPROVAL → AWAITING_MODELING (changes requested on ${d.number})`,
        });
      } else await syncOrderStatus(tx, userId, orderId);
    }
  });
}

export async function logTime(userId: string, projectId: string, input: { category: string; hours: string; date: Date | null; billable: boolean; notes: string | null }) {
  const h = dec(input.hours);
  if (h.lte(0) || h.gt(24)) throw new ServiceError("Hours must be between 0 and 24 per entry.");
  return prisma.$transaction(async (tx) => {
    const e = await tx.designTimeEntry.create({
      data: { projectId, category: input.category as never, hours: h.toFixed(2), date: input.date ?? new Date(), billable: input.billable, notes: input.notes },
    });
    const d = await tx.designProject.findUniqueOrThrow({ where: { id: projectId } });
    if (d.status === "REQUESTED") await tx.designProject.update({ where: { id: projectId }, data: { status: "IN_PROGRESS" } });
    await audit(tx, { userId, entityType: "DESIGN", entityId: projectId, action: "TIME", summary: `Logged ${h.toFixed(2)} h ${input.category.toLowerCase().replace("_", " ")}` });
    return e;
  });
}

export async function deleteTimeEntry(userId: string, entryId: string) {
  return prisma.$transaction(async (tx) => {
    const e = await tx.designTimeEntry.delete({ where: { id: entryId } });
    await audit(tx, { userId, entityType: "DESIGN", entityId: e.projectId, action: "TIME_DELETE", summary: `Removed time entry (${e.hours.toString()} h)` });
  });
}

/** Records a customer revision request; beyond the included allowance it becomes chargeable. */
export async function requestRevision(userId: string, projectId: string, description: string) {
  if (!description || description.trim().length < 3) throw new ServiceError("Describe the requested change.");
  return prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DesignProject" WHERE id = ${projectId} FOR UPDATE`;
      const d = await tx.designProject.findUnique({ where: { id: projectId }, include: { _count: { select: { revisions: true } } } });
      if (!d) throw new NotFoundError("Design project");
      const errors = checkDesignTransition(d.status as DesignStatus, "REVISION_REQUESTED");
      if (errors.length) throw new ServiceError(errors[0]);
      const number = d._count.revisions + 1;
      const chargeable = isRevisionChargeable(number, d.includedRevisions);
      const rev = await tx.designRevision.create({ data: { projectId, number, description: description.trim(), isChargeable: chargeable, charge: chargeable ? d.additionalRevisionFee : null } });
      await tx.designProject.update({ where: { id: projectId }, data: { status: "REVISION_REQUESTED" } });
      await audit(tx, {
        userId,
        entityType: "DESIGN",
        entityId: projectId,
        action: "REVISION",
        summary: `Revision ${number} requested${chargeable ? ` (beyond ${d.includedRevisions} included — chargeable)` : ""}`,
      });
      return rev;
    })
    .then(async (rev) => {
      // Keep linked orders consistent (awaiting approval → back to modeling).
      const d = await prisma.designProject.findUniqueOrThrow({ where: { id: projectId }, include: { orderItems: { select: { orderId: true } } } });
      for (const orderId of new Set(d.orderItems.map((i) => i.orderId))) {
        const o = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
        if (o?.status === "AWAITING_APPROVAL") {
          await prisma.$transaction(async (tx) => {
            await tx.order.update({ where: { id: orderId }, data: { status: "AWAITING_MODELING" } });
            await audit(tx, {
              userId: null,
              entityType: "ORDER",
              entityId: orderId,
              action: "STATUS",
              summary: `Automatically moved AWAITING_APPROVAL → AWAITING_MODELING (revision requested on ${d.number})`,
            });
          });
        }
      }
      return rev;
    });
}

export async function completeRevision(userId: string, revisionId: string) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.designRevision.update({ where: { id: revisionId }, data: { completedAt: new Date() } });
    await audit(tx, { userId, entityType: "DESIGN", entityId: r.projectId, action: "REVISION_DONE", summary: `Revision ${r.number} completed` });
  });
}

/** Bills chargeable, unbilled revisions as a new draft order for the customer. */
export async function billRevisions(userId: string, projectId: string) {
  return prisma.$transaction(async (tx) => {
    // The project row lock serializes concurrent clicks: the second one finds nothing left to bill.
    await tx.$queryRaw`SELECT id FROM "DesignProject" WHERE id = ${projectId} FOR UPDATE`;
    const d = await tx.designProject.findUnique({ where: { id: projectId }, include: { revisions: { where: { isChargeable: true, billedAt: null } } } });
    if (!d) throw new NotFoundError("Design project");
    const pending = d.revisions.filter((r) => r.charge && dec(r.charge.toString()).gt(0));
    if (pending.length === 0) throw new ServiceError("No unbilled chargeable revisions with a fee. Set the additional revision fee on the project first.");
    const total = pending.reduce((a, r) => a.plus(dec(r.charge!.toString())), ZERO);
    const form: OrderForm = {
      customerId: d.customerId,
      title: `Additional design work — ${d.number}`,
      pricingPolicyId: null,
      orderDiscountType: null,
      orderDiscountValue: null,
      shippingMethod: null,
      shippingCharge: null,
      shippingCost: null,
      depositPercent: null,
      paymentTerms: null,
      customerNotes: null,
      internalNotes: `Revisions ${pending.map((r) => r.number).join(", ")} beyond the ${d.includedRevisions} included.`,
      refreshRates: true,
      dueDate: null,
      priority: "NORMAL",
      deliveryMethod: "PICKUP",
      deliveryAddress: null,
      confirm: false,
      lines: [
        {
          id: null,
          serviceType: "MODELING_ONLY",
          partName: `${d.title} — additional revisions (${pending.length})`,
          description: pending
            .map((r) => `Rev ${r.number}: ${r.description}`)
            .join("; ")
            .slice(0, 1000),
          category: "Design",
          quantity: 1,
          colorNote: null,
          deadline: null,
          specialInstructions: null,
          materialId: null,
          supportMaterialId: null,
          printerId: null,
          designProjectId: d.id,
          gramsPerUnit: null,
          supportGramsPerUnit: null,
          purgeGramsPerBatch: null,
          unitsPerBatch: null,
          printMinutesPerUnit: null,
          setupMinutesPerBatch: null,
          postProcessMinutesPerUnit: null,
          extraCostPerUnit: null,
          extraCostNote: null,
          modelingMode: "FIXED",
          modelingHours: null,
          modelingFee: total.toFixed(2),
          designFeeWaived: false,
          waivedReason: null,
          scanHours: null,
          scanCleanupHours: null,
          reverseEngineeringHours: null,
          discountType: null,
          discountValue: null,
          manualUnitPrice: null,
          manualPriceReason: null,
        },
      ],
    };
    const order = await saveOrderTx(tx, userId, null, form);
    await tx.designRevision.updateMany({ where: { id: { in: pending.map((r) => r.id) } }, data: { billedAt: new Date() } });
    return order;
  });
}

export function designFeeEstimate(d: { feeMode: string; fixedFee: { toString(): string } | null; hourlyRate: { toString(): string } | null; estimatedHours: { toString(): string } | null }) {
  if (d.feeMode === "FIXED") return d.fixedFee ? dec(d.fixedFee.toString()).toFixed(2) : null;
  if (!d.hourlyRate || !d.estimatedHours) return null;
  return dec(d.hourlyRate.toString()).times(dec(d.estimatedHours.toString())).toFixed(2);
}
