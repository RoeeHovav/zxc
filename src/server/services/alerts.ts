import "server-only";
import { prisma } from "../db";
import { dec } from "@/domain/money";
import { expireQuotes } from "./quotes";
import { stockSummaries } from "./materials";
import { dueMaintenance } from "./printers";
import { date } from "@/lib/format";

export type AlertSeverity = "danger" | "warning" | "info";
export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: "deadline" | "overdue" | "stock" | "approval" | "payment" | "maintenance" | "quote";
  title: string;
  detail: string;
  href: string;
}

/** In-app alerts computed live from business data (nothing is sent to customers). */
export async function computeAlerts(now = new Date()): Promise<Alert[]> {
  await expireQuotes(now);
  const soon = new Date(now.getTime() + 3 * 86400000);
  const live = { notIn: ["DRAFT", "COMPLETED", "CANCELED", "DELIVERED"] as ("DRAFT" | "COMPLETED" | "CANCELED" | "DELIVERED")[] };
  const [overdue, dueSoon, materials, sentQuotes, designsAwaiting, unpaid, awaitingDeposit, maintenance] = await Promise.all([
    prisma.order.findMany({
      where: { status: live, dueDate: { lt: now } },
      select: { id: true, number: true, dueDate: true, customer: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.order.findMany({
      where: { status: live, dueDate: { gte: now, lt: soon } },
      select: { id: true, number: true, dueDate: true, status: true, customer: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.material.findMany({ where: { isActive: true, minStockG: { gt: 0 } }, select: { id: true, brand: true, colorName: true, minStockG: true, materialType: { select: { code: true } } } }),
    prisma.quote.findMany({
      where: { status: "SENT" },
      select: { id: true, number: true, validUntil: true, sentAt: true, customer: { select: { name: true } } },
      orderBy: { validUntil: "asc" },
      take: 30,
    }),
    prisma.designProject.findMany({ where: { status: "AWAITING_APPROVAL" }, select: { id: true, number: true, title: true, customer: { select: { name: true } }, updatedAt: true }, take: 20 }),
    prisma.order.findMany({
      where: { status: { in: ["READY", "DELIVERED"] } },
      select: { id: true, number: true, total: true, amountPaid: true, status: true, customer: { select: { name: true } } },
      take: 50,
    }),
    prisma.order.findMany({ where: { status: "AWAITING_PAYMENT" }, select: { id: true, number: true, depositAmount: true, amountPaid: true, customer: { select: { name: true } } }, take: 20 }),
    dueMaintenance(),
  ]);
  const stock = await stockSummaries(materials.map((m) => m.id));
  const alerts: Alert[] = [];
  for (const o of overdue)
    alerts.push({
      id: `overdue-${o.id}`,
      severity: "danger",
      category: "overdue",
      title: `${o.number} is overdue`,
      detail: `${o.customer.name} · was due ${date(o.dueDate!)}`,
      href: `/orders/${o.id}`,
    });
  for (const o of dueSoon)
    alerts.push({
      id: `soon-${o.id}`,
      severity: "warning",
      category: "deadline",
      title: `${o.number} due ${date(o.dueDate!)}`,
      detail: `${o.customer.name} · ${o.status.toLowerCase().replace(/_/g, " ")}`,
      href: `/orders/${o.id}`,
    });
  for (const m of materials) {
    const s = stock.get(m.id);
    if (s?.lowStock)
      alerts.push({
        id: `stock-${m.id}`,
        severity: "warning",
        category: "stock",
        title: `Low stock: ${m.materialType.code} ${m.brand} ${m.colorName}`,
        detail: `${Math.round(Number(s.availableG))} g available${s.hasEstimates ? " (estimated)" : ""} · minimum ${m.minStockG} g`,
        href: `/materials/${m.id}`,
      });
    else if (s?.nearThreshold)
      alerts.push({
        id: `stock-${m.id}`,
        severity: "info",
        category: "stock",
        title: `Check stock: ${m.materialType.code} ${m.brand} ${m.colorName}`,
        detail: `Estimated ${Math.round(Number(s.availableG))} g is close to the minimum — weigh spools to confirm`,
        href: `/materials/${m.id}`,
      });
  }
  for (const q of sentQuotes) {
    const expiring = q.validUntil && q.validUntil < soon;
    alerts.push({
      id: `quote-${q.id}`,
      severity: expiring ? "warning" : "info",
      category: "quote",
      title: expiring ? `${q.number} expires ${date(q.validUntil!)}` : `${q.number} awaiting customer response`,
      detail: `${q.customer.name}${q.sentAt ? ` · sent ${date(q.sentAt)}` : ""}`,
      href: `/quotes/${q.id}`,
    });
  }
  for (const d of designsAwaiting)
    alerts.push({ id: `design-${d.id}`, severity: "info", category: "approval", title: `${d.number} awaiting customer approval`, detail: `${d.title} · ${d.customer.name}`, href: `/designs/${d.id}` });
  for (const o of unpaid) {
    const due = dec(o.total.toString()).minus(dec(o.amountPaid.toString()));
    if (due.gt(0))
      alerts.push({
        id: `unpaid-${o.id}`,
        severity: o.status === "DELIVERED" ? "danger" : "warning",
        category: "payment",
        title: `${o.number}: ${due.toFixed(2)} unpaid`,
        detail: `${o.customer.name} · ${o.status === "DELIVERED" ? "delivered" : "ready for pickup"}`,
        href: `/orders/${o.id}`,
      });
  }
  for (const o of awaitingDeposit)
    alerts.push({
      id: `deposit-${o.id}`,
      severity: "info",
      category: "payment",
      title: `${o.number} waiting for deposit`,
      detail: `${o.customer.name} · deposit ${o.depositAmount.toString()}`,
      href: `/orders/${o.id}`,
    });
  for (const m of maintenance)
    alerts.push({
      id: `maint-${m.taskId}`,
      severity: m.overdue ? "danger" : "warning",
      category: "maintenance",
      title: `${m.printerName}: ${m.title}`,
      detail: m.dueReason,
      href: `/printers/${m.printerId}`,
    });
  const order: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
