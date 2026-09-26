import "server-only";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/services/settings";

export async function expenseFormData() {
  const [suppliers, printers, settings] = await Promise.all([
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.printer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return { suppliers, printers, vatRate: settings.vatMode === "EXCLUSIVE" ? settings.vatRate.toString() : null };
}
