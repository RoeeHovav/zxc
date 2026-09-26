import "server-only";
import { prisma } from "../db";
import { normalizePhone } from "@/domain/schemas/customer";

export interface SearchHit {
  type: "customer" | "order" | "quote" | "material" | "design" | "printer" | "job";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Global search across the main entities. Case-insensitive substring match. */
export async function globalSearch(qRaw: string): Promise<SearchHit[]> {
  const q = qRaw.trim().slice(0, 100);
  if (q.length < 2) return [];
  const ci = { contains: q, mode: "insensitive" as const };
  const phone = normalizePhone(q);
  const [customers, orders, quotes, materials, designs, printers, jobs] = await Promise.all([
    prisma.customer.findMany({
      where: { OR: [{ name: ci }, { company: ci }, { email: ci }, { number: ci }, ...(phone ? [{ phoneNormalized: { contains: phone } }] : [])] },
      take: 6,
      select: { id: true, name: true, company: true, number: true, phone: true, archivedAt: true },
    }),
    prisma.order.findMany({
      where: { OR: [{ number: ci }, { title: ci }, { customer: { name: ci } }, { items: { some: { partName: ci } } }] },
      take: 6,
      orderBy: { orderDate: "desc" },
      select: { id: true, number: true, title: true, status: true, customer: { select: { name: true } } },
    }),
    prisma.quote.findMany({
      where: { OR: [{ number: ci }, { title: ci }, { customer: { name: ci } }, { items: { some: { partName: ci } } }] },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, revision: true, title: true, status: true, customer: { select: { name: true } } },
    }),
    prisma.material.findMany({
      where: { OR: [{ brand: ci }, { productLine: ci }, { colorName: ci }, { sku: ci }, { materialType: { code: ci } }] },
      take: 6,
      select: { id: true, brand: true, productLine: true, colorName: true, materialType: { select: { code: true } } },
    }),
    prisma.designProject.findMany({
      where: { OR: [{ number: ci }, { title: ci }, { customer: { name: ci } }] },
      take: 5,
      select: { id: true, number: true, title: true, customer: { select: { name: true } } },
    }),
    prisma.printer.findMany({ where: { OR: [{ name: ci }, { model: ci }, { serialNumber: ci }] }, take: 4, select: { id: true, name: true, model: true } }),
    prisma.printJob.findMany({ where: { number: ci }, take: 4, select: { id: true, number: true, status: true, order: { select: { number: true } } } }),
  ]);
  return [
    ...customers.map((c) => ({
      type: "customer" as const,
      id: c.id,
      title: c.name,
      subtitle: [c.number, c.company, c.phone, c.archivedAt ? "archived" : null].filter(Boolean).join(" · "),
      href: `/customers/${c.id}`,
    })),
    ...orders.map((o) => ({
      type: "order" as const,
      id: o.id,
      title: `${o.number}${o.title ? ` — ${o.title}` : ""}`,
      subtitle: `${o.customer.name} · ${o.status.toLowerCase().replace(/_/g, " ")}`,
      href: `/orders/${o.id}`,
    })),
    ...quotes.map((x) => ({
      type: "quote" as const,
      id: x.id,
      title: `${x.number}${x.revision > 1 ? ` rev ${x.revision}` : ""}${x.title ? ` — ${x.title}` : ""}`,
      subtitle: `${x.customer.name} · ${x.status.toLowerCase()}`,
      href: `/quotes/${x.id}`,
    })),
    ...designs.map((d) => ({ type: "design" as const, id: d.id, title: `${d.number} — ${d.title}`, subtitle: d.customer.name, href: `/designs/${d.id}` })),
    ...materials.map((m) => ({
      type: "material" as const,
      id: m.id,
      title: `${m.materialType.code} · ${m.brand}${m.productLine ? ` ${m.productLine}` : ""}`,
      subtitle: m.colorName,
      href: `/materials/${m.id}`,
    })),
    ...printers.map((p) => ({ type: "printer" as const, id: p.id, title: p.name, subtitle: p.model, href: `/printers/${p.id}` })),
    ...jobs.map((j) => ({ type: "job" as const, id: j.id, title: j.number, subtitle: `Order ${j.order.number} · ${j.status.toLowerCase()}`, href: `/production?job=${j.id}` })),
  ];
}
