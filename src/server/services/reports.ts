import "server-only";
import { prisma } from "../db";
import { D, ZERO, dec } from "@/domain/money";
import type { LineResult } from "@/domain/pricing/types";
import type { Period } from "./finance";

type Agg = { key: string; label: string; revenue: InstanceType<typeof D>; cost: InstanceType<typeof D>; orders: Set<string>; units: number; grams: InstanceType<typeof D>; hours: InstanceType<typeof D> };

function agg(map: Map<string, Agg>, key: string, label: string) {
  let a = map.get(key);
  if (!a) {
    a = { key, label, revenue: ZERO, cost: ZERO, orders: new Set(), units: 0, grams: ZERO, hours: ZERO };
    map.set(key, a);
  }
  return a;
}

function finish(map: Map<string, Agg>) {
  return [...map.values()]
    .map((a) => {
      const profit = a.revenue.minus(a.cost);
      return {
        key: a.key,
        label: a.label,
        orders: a.orders.size,
        units: a.units,
        grams: a.grams.toFixed(0),
        machineHours: a.hours.toFixed(1),
        revenue: a.revenue.toFixed(2),
        cost: a.cost.toFixed(2),
        profit: profit.toFixed(2),
        margin: a.revenue.gt(0) ? profit.div(a.revenue).toFixed(4) : null,
      };
    })
    .sort((x, y) => Number(dec(y.revenue).minus(dec(x.revenue))));
}

/**
 * Profitability of delivered/completed orders in a period, grouped by order, customer,
 * material and printer. Line-level figures use estimated line cost (net of VAT); order-level
 * figures use actual cost when available.
 */
export async function profitability(p: Period) {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["DELIVERED", "COMPLETED"] }, deliveredAt: { gte: p.from, lt: p.to } },
    include: {
      customer: { select: { id: true, name: true } },
      items: { include: { material: { select: { id: true, brand: true, colorName: true, materialType: { select: { code: true } } } }, printer: { select: { id: true, name: true } } } },
    },
    orderBy: { deliveredAt: "asc" },
  });
  const byCustomer = new Map<string, Agg>();
  const byMaterial = new Map<string, Agg>();
  const byPrinter = new Map<string, Agg>();
  const byService = new Map<string, Agg>();
  const byOrder = orders.map((o) => {
    const est = dec(o.estimatedCost.toString());
    const actual = o.actualCost ? dec(o.actualCost.toString()) : null;
    const revenue = dec(o.taxableAmount.toString());
    const cost = actual ?? est;
    const c = agg(byCustomer, o.customer.id, o.customer.name);
    c.revenue = c.revenue.plus(revenue);
    c.cost = c.cost.plus(cost);
    c.orders.add(o.id);
    // Order-level revenue beyond line nets (discounts, minimums, shipping) is allocated to lines pro rata.
    const itemsNet = o.items.reduce((a, i) => a.plus(dec(i.lineNet?.toString() ?? "0")), ZERO);
    const scale = itemsNet.gt(0) ? revenue.div(itemsNet) : ZERO;
    for (const it of o.items) {
      const r = it.pricingResult as LineResult | null;
      const lineRevenue = dec(it.lineNet?.toString() ?? "0").times(scale);
      const lineCost = dec(it.lineCost?.toString() ?? "0");
      const grams = r?.production ? dec(r.production.grams.total) : ZERO;
      const hours = r?.production ? dec(r.production.machineHours) : ZERO;
      for (const [map, key, label] of [
        [byMaterial, it.material?.id ?? "none", it.material ? `${it.material.materialType.code} ${it.material.brand} ${it.material.colorName}` : "No material (services)"],
        [byPrinter, it.printer?.id ?? "none", it.printer?.name ?? "No printer (services)"],
        [byService, it.serviceType, it.serviceType],
      ] as [Map<string, Agg>, string, string][]) {
        const a = agg(map, key, label);
        a.revenue = a.revenue.plus(lineRevenue);
        a.cost = a.cost.plus(lineCost);
        a.orders.add(o.id);
        a.units += it.quantity;
        a.grams = a.grams.plus(grams);
        a.hours = a.hours.plus(hours);
      }
    }
    const profit = revenue.minus(cost);
    return {
      id: o.id,
      number: o.number,
      customer: o.customer.name,
      deliveredAt: o.deliveredAt!,
      revenue: revenue.toFixed(2),
      estimatedCost: est.toFixed(2),
      actualCost: actual?.toFixed(2) ?? null,
      variance: actual ? actual.minus(est).toFixed(2) : null,
      profit: profit.toFixed(2),
      margin: revenue.gt(0) ? profit.div(revenue).toFixed(4) : null,
    };
  });
  return { byOrder, byCustomer: finish(byCustomer), byMaterial: finish(byMaterial), byPrinter: finish(byPrinter), byService: finish(byService) };
}

/** Daily revenue/cash for a period (daily report). */
export async function dailySeries(p: Period) {
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["DELIVERED", "COMPLETED"] }, deliveredAt: { gte: p.from, lt: p.to } }, select: { deliveredAt: true, taxableAmount: true, estimatedCost: true, actualCost: true } }),
    prisma.payment.findMany({ where: { voidedAt: null, receivedAt: { gte: p.from, lt: p.to } }, select: { receivedAt: true, kind: true, amount: true } }),
  ]);
  const days = new Map<string, { revenue: InstanceType<typeof D>; cogs: InstanceType<typeof D>; cash: InstanceType<typeof D>; orders: number }>();
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ || "Asia/Jerusalem" }).format(d);
  const get = (k: string) => {
    let v = days.get(k);
    if (!v) days.set(k, (v = { revenue: ZERO, cogs: ZERO, cash: ZERO, orders: 0 }));
    return v;
  };
  for (const o of orders) {
    const d = get(key(o.deliveredAt!));
    d.revenue = d.revenue.plus(dec(o.taxableAmount.toString()));
    d.cogs = d.cogs.plus(dec((o.actualCost ?? o.estimatedCost).toString()));
    d.orders++;
  }
  for (const pmt of payments) {
    const d = get(key(pmt.receivedAt));
    d.cash = pmt.kind === "REFUND" ? d.cash.minus(dec(pmt.amount.toString())) : d.cash.plus(dec(pmt.amount.toString()));
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, orders: v.orders, revenue: v.revenue.toFixed(2), cogs: v.cogs.toFixed(2), grossProfit: v.revenue.minus(v.cogs).toFixed(2), cash: v.cash.toFixed(2) }));
}
