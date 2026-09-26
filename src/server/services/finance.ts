import "server-only";
import { prisma } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { D, ZERO, dec } from "@/domain/money";

/**
 * Metric definitions (also shown in the UI):
 *  - Recognized revenue: net (excl. VAT) value of orders DELIVERED or COMPLETED, by delivery date.
 *  - Booked revenue: net value of orders confirmed in the period (sales activity), by confirmation date.
 *  - Cash received: payments minus refunds (non-voided), by payment date. Includes VAT and deposits.
 *  - Receivables: amount still owed on live orders (total − paid).
 *  - Deposits held: cash received for orders not yet delivered.
 *  - Cost of goods (COGS): actual cost of recognized orders when known, else their estimate.
 *  - Gross profit = recognized revenue − COGS.
 *  - Operating expenses: expenses excluding materials and equipment (materials enter COGS when consumed;
 *    equipment enters COGS through the machine-hour depreciation rate).
 *  - Indicative net profit = gross profit − operating expenses. Not a tax or accounting statement.
 */
export interface Period {
  from: Date;
  to: Date;
}

const sumDec = (values: { toString(): string }[]) => values.reduce<InstanceType<typeof D>>((a, v) => a.plus(dec(v.toString())), ZERO);

export function monthPeriod(d = new Date()): Period {
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
}
export function yearPeriod(y = new Date().getFullYear()): Period {
  return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
}

export async function financeSummary(p: Period) {
  const recognizedWhere: Prisma.OrderWhereInput = { status: { in: ["DELIVERED", "COMPLETED"] }, deliveredAt: { gte: p.from, lt: p.to } };
  const [recognized, booked, payments, receivableOrders, heldOrders, expenses] = await Promise.all([
    prisma.order.findMany({ where: recognizedWhere, select: { taxableAmount: true, vatAmount: true, estimatedCost: true, actualCost: true } }),
    prisma.order.findMany({ where: { status: { notIn: ["DRAFT", "CANCELED"] }, confirmedAt: { gte: p.from, lt: p.to } }, select: { taxableAmount: true, estimatedProfit: true } }),
    prisma.payment.findMany({ where: { voidedAt: null, receivedAt: { gte: p.from, lt: p.to } }, select: { kind: true, amount: true, feeAmount: true, method: true } }),
    prisma.order.findMany({ where: { status: { notIn: ["DRAFT", "CANCELED"] } }, select: { total: true, amountPaid: true } }),
    prisma.order.findMany({ where: { status: { in: ["AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL", "QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "READY"] } }, select: { amountPaid: true } }),
    prisma.expense.groupBy({ by: ["category"], where: { date: { gte: p.from, lt: p.to } }, _sum: { amount: true, vatAmount: true } }),
  ]);
  const revenue = sumDec(recognized.map((o) => o.taxableAmount));
  const vatCollected = sumDec(recognized.map((o) => o.vatAmount));
  const cogs = sumDec(recognized.map((o) => o.actualCost ?? o.estimatedCost));
  const cogsActualShare = recognized.filter((o) => o.actualCost !== null).length;
  const cashIn = payments.reduce((a, x) => (x.kind === "REFUND" ? a.minus(dec(x.amount.toString())) : a.plus(dec(x.amount.toString()))), ZERO);
  const refunds = sumDec(payments.filter((x) => x.kind === "REFUND").map((x) => x.amount));
  const fees = sumDec(payments.map((x) => x.feeAmount));
  const byMethod = new Map<string, InstanceType<typeof D>>();
  for (const x of payments) byMethod.set(x.method, (byMethod.get(x.method) ?? ZERO).plus(x.kind === "REFUND" ? dec(x.amount.toString()).neg() : dec(x.amount.toString())));
  const receivables = receivableOrders.reduce((a, o) => {
    const due = dec(o.total.toString()).minus(dec(o.amountPaid.toString()));
    return due.gt(0) ? a.plus(due) : a;
  }, ZERO);
  const depositsHeld = sumDec(heldOrders.map((o) => o.amountPaid));
  const expenseByCategory = expenses.map((e) => ({ category: e.category, amount: dec(e._sum.amount?.toString() ?? "0"), vat: dec(e._sum.vatAmount?.toString() ?? "0") }));
  const totalExpenses = expenseByCategory.reduce((a, e) => a.plus(e.amount), ZERO);
  const materialSpend = expenseByCategory.filter((e) => e.category === "MATERIALS").reduce((a, e) => a.plus(e.amount), ZERO);
  const operating = expenseByCategory.filter((e) => e.category !== "MATERIALS" && e.category !== "EQUIPMENT").reduce((a, e) => a.plus(e.amount), ZERO);
  const grossProfit = revenue.minus(cogs);
  const f = (v: InstanceType<typeof D>) => v.toFixed(2);
  return {
    revenue: f(revenue),
    vatCollected: f(vatCollected),
    ordersRecognized: recognized.length,
    booked: f(sumDec(booked.map((o) => o.taxableAmount))),
    bookedProfit: f(sumDec(booked.map((o) => o.estimatedProfit))),
    ordersBooked: booked.length,
    cashIn: f(cashIn),
    refunds: f(refunds),
    paymentFees: f(fees),
    byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount: f(amount) })),
    receivables: f(receivables),
    depositsHeld: f(depositsHeld),
    cogs: f(cogs),
    cogsActualShare,
    grossProfit: f(grossProfit),
    grossMargin: revenue.gt(0) ? grossProfit.div(revenue).toFixed(4) : null,
    expenses: f(totalExpenses),
    expenseByCategory: expenseByCategory.map((e) => ({ category: e.category, amount: f(e.amount), vat: f(e.vat) })),
    materialSpend: f(materialSpend),
    operatingExpenses: f(operating),
    netProfit: f(grossProfit.minus(operating)),
  };
}

export type FinanceSummary = Awaited<ReturnType<typeof financeSummary>>;

/** Revenue, cash and gross profit per month for a year (for charts and the yearly report). */
export async function monthlySeries(year: number) {
  const { from, to } = yearPeriod(year);
  const [orders, payments, expenses] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["DELIVERED", "COMPLETED"] }, deliveredAt: { gte: from, lt: to } }, select: { deliveredAt: true, taxableAmount: true, estimatedCost: true, actualCost: true } }),
    prisma.payment.findMany({ where: { voidedAt: null, receivedAt: { gte: from, lt: to } }, select: { receivedAt: true, kind: true, amount: true } }),
    prisma.expense.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, category: true } }),
  ]);
  const months = Array.from({ length: 12 }, (_, m) => ({ month: m, revenue: ZERO, cogs: ZERO, cash: ZERO, expenses: ZERO }));
  for (const o of orders) {
    const m = months[o.deliveredAt!.getMonth()];
    m.revenue = m.revenue.plus(dec(o.taxableAmount.toString()));
    m.cogs = m.cogs.plus(dec((o.actualCost ?? o.estimatedCost).toString()));
  }
  for (const p of payments) {
    const m = months[p.receivedAt.getMonth()];
    m.cash = p.kind === "REFUND" ? m.cash.minus(dec(p.amount.toString())) : m.cash.plus(dec(p.amount.toString()));
  }
  for (const e of expenses) {
    const m = months[e.date.getMonth()];
    m.expenses = m.expenses.plus(dec(e.amount.toString()));
  }
  return months.map((m) => ({ month: m.month, revenue: m.revenue.toFixed(2), cogs: m.cogs.toFixed(2), grossProfit: m.revenue.minus(m.cogs).toFixed(2), cash: m.cash.toFixed(2), expenses: m.expenses.toFixed(2) }));
}

export async function listExpenses(opts: { from?: Date; to?: Date; category?: string; q?: string }) {
  const where: Prisma.ExpenseWhereInput = {};
  if (opts.from || opts.to) where.date = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) };
  if (opts.category) where.category = opts.category as Prisma.ExpenseWhereInput["category"];
  if (opts.q) where.OR = [{ description: { contains: opts.q, mode: "insensitive" } }, { reference: { contains: opts.q, mode: "insensitive" } }, { supplier: { name: { contains: opts.q, mode: "insensitive" } } }];
  return prisma.expense.findMany({ where, orderBy: { date: "desc" }, take: 500, include: { supplier: { select: { name: true } }, printer: { select: { name: true } }, order: { select: { id: true, number: true } }, _count: { select: { files: true } } } });
}

import { ServiceError, audit } from "./common";

export interface ExpenseInput {
  date: Date | null;
  category: string;
  description: string;
  supplierId: string | null;
  amount: string;
  vatAmount: string | null;
  paymentMethod: string | null;
  reference: string | null;
  printerId: string | null;
  orderId: string | null;
  notes: string | null;
}

export async function saveExpense(userId: string, id: string | null, i: ExpenseInput) {
  if (i.vatAmount && dec(i.vatAmount).gt(dec(i.amount))) throw new ServiceError("VAT cannot exceed the total amount.");
  const data = {
    date: i.date ?? new Date(),
    category: i.category as never,
    description: i.description,
    supplierId: i.supplierId,
    amount: i.amount,
    vatAmount: i.vatAmount ?? "0",
    paymentMethod: (i.paymentMethod || null) as never,
    reference: i.reference,
    printerId: i.printerId,
    orderId: i.orderId,
    notes: i.notes,
  };
  return prisma.$transaction(async (tx) => {
    const e = id ? await tx.expense.update({ where: { id }, data }) : await tx.expense.create({ data });
    await audit(tx, { userId, entityType: "EXPENSE", entityId: e.id, action: id ? "UPDATE" : "CREATE", summary: `${id ? "Updated" : "Recorded"} expense ${e.description} (${e.amount.toString()})` });
    return e;
  });
}

export async function deleteExpense(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const spools = await tx.spool.count({ where: { expenseId: id } });
    const e = await tx.expense.delete({ where: { id } });
    await audit(tx, { userId, entityType: "EXPENSE", entityId: id, action: "DELETE", summary: `Deleted expense ${e.description} (${e.amount.toString()})${spools ? `; ${spools} spool(s) keep their landed cost` : ""}` });
  });
}
