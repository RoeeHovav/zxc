"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { orderSchema, paymentSchema } from "@/domain/schemas/sales";
import { formToObject } from "@/domain/schemas/common";
import { ORDER_STATUSES } from "@/domain/status/order";
import { ServiceError } from "@/server/services/common";
import { saveOrder, transitionOrder } from "@/server/services/orders";
import { recordPayment, voidPayment } from "@/server/services/payments";
import { createJobsForOrder } from "@/server/services/production";
import { prisma } from "@/server/db";

const refresh = (id: string) => {
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/production");
};

export async function saveOrderAction(id: string | null, payload: string, clientKey: string, intent: "draft" | "confirm"): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("sales");
  return runAction(async () => {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(payload);
    } catch {
      throw new ServiceError("The form data was malformed.");
    }
    const form = orderSchema.parse({ ...raw, confirm: intent === "confirm" });
    const o = await saveOrder(user.id, id, form, id ? null : clientKey.slice(0, 64));
    refresh(o.id);
    return { id: o.id };
  });
}

export async function transitionOrderAction(id: string, to: string, reason: string | null) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const target = z.enum(ORDER_STATUSES).parse(to);
    const r = await transitionOrder(user.id, id, target, reason?.trim().slice(0, 300) || null);
    refresh(id);
    return r;
  }, "Order updated.");
}

export async function recordPaymentAction(orderId: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const form = paymentSchema.parse(formToObject(fd));
    await recordPayment(user.id, orderId, form);
    refresh(orderId);
    revalidatePath("/finance");
  }, "Payment recorded.");
}

export async function voidPaymentAction(orderId: string, paymentId: string, reason: string) {
  const user = await requireUser("finance");
  return runAction(async () => {
    await voidPayment(user.id, paymentId, reason);
    refresh(orderId);
    revalidatePath("/finance");
  }, "Payment voided.");
}

export async function createJobsAction(orderId: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    const created = await createJobsForOrder(user.id, orderId);
    refresh(orderId);
    return created;
  }, "Print jobs created.");
}

export async function deleteDraftOrderAction(orderId: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const o = await prisma.order.findUnique({ where: { id: orderId }, include: { _count: { select: { payments: true } } } });
    if (!o) return;
    if (o.status !== "DRAFT" || o._count.payments > 0) throw new ServiceError("Only unpaid drafts can be deleted. Cancel confirmed orders instead.");
    await prisma.$transaction(async (tx) => {
      await tx.order.delete({ where: { id: orderId } });
      await tx.auditLog.create({ data: { userId: user.id, entityType: "ORDER", entityId: orderId, action: "DELETE", summary: `Deleted draft ${o.number}` } });
    });
    revalidatePath("/orders");
  }, "Draft deleted.");
}
