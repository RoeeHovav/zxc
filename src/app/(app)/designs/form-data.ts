import "server-only";
import { prisma } from "@/server/db";
import { materialOptions } from "@/server/services/materials";
import { getSettings } from "@/server/services/settings";

export async function designFormData() {
  const [customers, materials, printers, settings] = await Promise.all([
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, company: true } }),
    materialOptions(),
    prisma.printer.findMany({ where: { status: { not: "RETIRED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return {
    customers: customers.map((c) => ({ id: c.id, label: c.company ? `${c.name} (${c.company})` : c.name })),
    materials: materials.map((m) => ({ id: m.id, label: m.label })),
    printers,
    defaultRate: settings.modelingRatePerHour.toString(),
  };
}
