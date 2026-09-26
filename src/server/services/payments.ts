import "server-only";
import { prisma } from "../db";
import { ZERO, dec } from "@/domain/money";
import type { PaymentForm } from "@/domain/schemas/sales";
import { NotFoundError, ServiceError, audit, idempotent, nextNumber } from "./common";
import { syncOrderStatus } from "./orders";

/**
 * Records a payment or refund. The order row is locked so concurrent payments cannot
 * both pass the balance checks; `amountPaid` is updated in the same transaction as the ledger row.
 */
export async function recordPayment(userId: string, orderId: string, form: PaymentForm) {
  return idempotent(
    form.idempotencyKey,
    (key) => prisma.payment.findUnique({ where: { clientKey: key } }),
    () => recordPaymentTx(userId, orderId, form),
  );
}

function recordPaymentTx(userId: string, orderId: string, form: PaymentForm) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order");
    const amount = dec(form.amount);
    const paid = dec(order.amountPaid.toString());
    const total = dec(order.total.toString());
    if (form.kind === "PAYMENT") {
      if (order.status === "DRAFT") throw new ServiceError("Confirm the order before recording payments.");
      if (order.status === "CANCELED") throw new ServiceError("This order is canceled. Only refunds can be recorded.");
      const due = total.minus(paid);
      if (amount.gt(due)) throw new ServiceError(due.lte(0) ? "This order is already fully paid." : `Amount exceeds the balance due of ${due.toFixed(2)}.`);
    } else {
      if (amount.gt(paid)) throw new ServiceError(`A refund cannot exceed the net amount paid (${paid.toFixed(2)}).`);
    }
    const number = await nextNumber(tx, form.kind === "REFUND" ? "REFUND" : "PAYMENT");
    const payment = await tx.payment.create({
      data: {
        number,
        orderId,
        customerId: order.customerId,
        kind: form.kind,
        method: form.method,
        amount: amount.toFixed(2),
        isDeposit: form.kind === "PAYMENT" && form.isDeposit,
        receivedAt: form.receivedAt ?? new Date(),
        reference: form.reference,
        feeAmount: form.feeAmount ?? "0",
        notes: form.notes,
        clientKey: form.idempotencyKey,
        createdById: userId,
      },
    });
    await tx.order.update({ where: { id: orderId }, data: { amountPaid: form.kind === "REFUND" ? { decrement: amount.toFixed(2) } : { increment: amount.toFixed(2) } } });
    await audit(tx, {
      userId,
      entityType: "ORDER",
      entityId: orderId,
      action: form.kind,
      summary: `${form.kind === "REFUND" ? "Refund" : form.isDeposit ? "Deposit" : "Payment"} ${number}: ${amount.toFixed(2)} via ${form.method.toLowerCase().replace("_", " ")}`,
    });
    await syncOrderStatus(tx, userId, orderId);
    return payment;
  });
}

/** Voids a mistaken entry (kept for audit, excluded from totals). */
export async function voidPayment(userId: string, paymentId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new ServiceError("Give a reason for voiding.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    if (p.voidedAt) return p;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${p.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: p.orderId } });
    const paid = dec(order.amountPaid.toString());
    const amount = dec(p.amount.toString());
    const after = p.kind === "REFUND" ? paid.plus(amount) : paid.minus(amount);
    if (after.lt(0)) throw new ServiceError("Voiding this payment would leave more refunded than paid. Void the refund first.");
    await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason.trim() } });
    await tx.order.update({ where: { id: p.orderId }, data: { amountPaid: after.toFixed(2) } });
    await audit(tx, { userId, entityType: "ORDER", entityId: p.orderId, action: "VOID_PAYMENT", summary: `Voided ${p.number} (${amount.toFixed(2)}): ${reason.trim()}` });
    return p;
  });
}

/** Integrity check: recompute amountPaid from the ledger. Returns orders whose cache disagrees. */
export async function verifyPaymentCaches() {
  const orders = await prisma.order.findMany({ select: { id: true, number: true, amountPaid: true, payments: { where: { voidedAt: null }, select: { kind: true, amount: true } } } });
  const mismatches: { number: string; cached: string; ledger: string }[] = [];
  for (const o of orders) {
    const ledger = o.payments.reduce((a, p) => (p.kind === "REFUND" ? a.minus(dec(p.amount.toString())) : a.plus(dec(p.amount.toString()))), ZERO);
    if (!ledger.eq(dec(o.amountPaid.toString()))) mismatches.push({ number: o.number, cached: o.amountPaid.toString(), ledger: ledger.toFixed(2) });
  }
  return mismatches;
}

export async function getPaymentForReceipt(id: string) {
  return prisma.payment.findUnique({ where: { id }, include: { order: { include: { customer: true } }, customer: true } });
}
