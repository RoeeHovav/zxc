import "server-only";
import { prisma, type Tx } from "../db";
import { D, ZERO, dec } from "@/domain/money";
import { machineRateBreakdown } from "@/domain/pricing/engine";
import type { ResolvedPrinter } from "@/domain/pricing/types";
import { NotFoundError, ServiceError, audit } from "./common";
import { getSettings } from "./settings";
import { plural } from "@/lib/format";

type PrinterLike = {
  id: string;
  name: string;
  hourlyRateOverride: { toString(): string } | null;
  purchasePrice: { toString(): string } | null;
  expectedLifetimeHours: number | null;
  powerWatts: number | null;
  maintenancePerHour: { toString(): string } | null;
  consumablesPerHour: { toString(): string } | null;
};

export function toResolvedPrinter(p: PrinterLike): ResolvedPrinter {
  return {
    id: p.id,
    name: p.name,
    hourlyRateOverride: p.hourlyRateOverride?.toString() ?? null,
    purchasePrice: p.purchasePrice?.toString() ?? null,
    expectedLifetimeHours: p.expectedLifetimeHours?.toString() ?? null,
    powerWatts: p.powerWatts?.toString() ?? null,
    maintenancePerHour: p.maintenancePerHour?.toString() ?? null,
    consumablesPerHour: p.consumablesPerHour?.toString() ?? null,
  };
}

export async function resolvePrinter(tx: Tx | typeof prisma, id: string | null): Promise<ResolvedPrinter | null> {
  if (!id) return null;
  const p = await tx.printer.findUnique({ where: { id } });
  if (!p) throw new ServiceError("A selected printer no longer exists.");
  return toResolvedPrinter(p);
}

/** Lifetime print hours = initial hours + actual minutes of finished/failed jobs. */
export async function printerHours(ids?: string[]): Promise<Map<string, string>> {
  const printers = await prisma.printer.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, initialPrintHours: true } });
  const jobs = await prisma.printJob.groupBy({
    by: ["printerId"],
    where: { printerId: { in: printers.map((p) => p.id) }, status: { in: ["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"] } },
    _sum: { actualMinutes: true },
  });
  const map = new Map<string, string>();
  for (const p of printers) {
    const minutes = jobs.find((j) => j.printerId === p.id)?._sum.actualMinutes;
    map.set(
      p.id,
      dec(p.initialPrintHours.toString())
        .plus(minutes ? dec(minutes.toString()).div(60) : ZERO)
        .toFixed(1),
    );
  }
  return map;
}

export interface MaintenanceDue {
  taskId: string;
  printerId: string;
  printerName: string;
  title: string;
  dueReason: string;
  overdue: boolean;
}

export function maintenanceStatus(
  task: { id: string; title: string; intervalPrintHours: number | null; intervalDays: number | null; lastDoneAt: Date | null; lastDonePrintHours: { toString(): string } | null; createdAt: Date },
  currentHours: string,
  now = new Date(),
): { due: boolean; overdue: boolean; reason: string; hoursLeft: number | null; daysLeft: number | null } {
  let hoursLeft: number | null = null;
  let daysLeft: number | null = null;
  if (task.intervalPrintHours) {
    const since = dec(currentHours).minus(dec(task.lastDonePrintHours?.toString() ?? "0"));
    hoursLeft = Number(new D(task.intervalPrintHours).minus(since).toFixed(1));
  }
  if (task.intervalDays) {
    const base = task.lastDoneAt ?? task.createdAt;
    daysLeft = Math.floor((base.getTime() + task.intervalDays * 86400000 - now.getTime()) / 86400000);
  }
  const hoursDue = hoursLeft !== null && hoursLeft <= Math.max(5, (task.intervalPrintHours ?? 0) * 0.05);
  const daysDue = daysLeft !== null && daysLeft <= 3;
  const overdue = (hoursLeft !== null && hoursLeft < 0) || (daysLeft !== null && daysLeft < 0);
  const parts: string[] = [];
  if (hoursLeft !== null) parts.push(hoursLeft < 0 ? `${-hoursLeft} h overdue` : `${hoursLeft} h left`);
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `${plural(-daysLeft, "day")} overdue` : `${plural(daysLeft, "day")} left`);
  return { due: hoursDue || daysDue, overdue, reason: parts.join(" · "), hoursLeft, daysLeft };
}

export async function listPrinters(includeRetired = false) {
  const [printers, settings] = await Promise.all([
    prisma.printer.findMany({
      where: includeRetired ? {} : { status: { not: "RETIRED" } },
      orderBy: { name: "asc" },
      include: {
        supportedMaterialTypes: { select: { code: true } },
        maintenanceTasks: { where: { isActive: true } },
        jobs: { where: { status: { in: ["QUEUED", "PRINTING"] } }, select: { id: true, number: true, status: true, estimatedMinutes: true, startedAt: true, order: { select: { number: true } } } },
      },
    }),
    getSettings(),
  ]);
  const hours = await printerHours(printers.map((p) => p.id));
  return printers.map((p) => {
    const r = machineRateBreakdown(toResolvedPrinter(p), dec(settings.electricityTariffPerKwh.toString()), dec(settings.defaultMachineCostPerHour.toString()));
    const h = hours.get(p.id) ?? "0";
    const due = p.maintenanceTasks.map((t) => ({ t, s: maintenanceStatus(t, h) })).filter((x) => x.s.due);
    return { ...p, hours: h, rate: r.rate.toFixed(4), rateSource: r.source, rateMissing: r.missing, maintenanceDue: due.length, maintenanceOverdue: due.some((d) => d.s.overdue) };
  });
}

export async function getPrinter(id: string) {
  const p = await prisma.printer.findUnique({
    where: { id },
    include: {
      supportedMaterialTypes: true,
      maintenanceTasks: { where: { isActive: true }, orderBy: { title: "asc" } },
      maintenanceLogs: { orderBy: { performedAt: "desc" }, take: 50, include: { task: { select: { title: true } } } },
      jobs: { orderBy: { createdAt: "desc" }, take: 25, include: { order: { select: { id: true, number: true } } } },
    },
  });
  if (!p) return null;
  const settings = await getSettings();
  const hours = (await printerHours([id])).get(id) ?? "0";
  const rate = machineRateBreakdown(toResolvedPrinter(p), dec(settings.electricityTariffPerKwh.toString()), dec(settings.defaultMachineCostPerHour.toString()));
  const failed = await prisma.printJob.count({ where: { printerId: id, status: "FAILED" } });
  const done = await prisma.printJob.count({ where: { printerId: id, status: "DONE" } });
  return {
    printer: p,
    hours,
    rate: { total: rate.rate.toFixed(4), source: rate.source, missing: rate.missing, perHour: Object.fromEntries(Object.entries(rate.perHour).map(([k, v]) => [k, v.toFixed(4)])) },
    tasks: p.maintenanceTasks.map((t) => ({ ...t, status: maintenanceStatus(t, hours) })),
    stats: { done, failed, failureRate: done + failed > 0 ? (failed / (done + failed)).toFixed(4) : null },
  };
}

export interface PrinterInput {
  name: string;
  manufacturer: string | null;
  model: string;
  serialNumber: string | null;
  nozzleDiameterMm: string | null;
  nozzleNotes: string | null;
  hasMultiMaterial: boolean;
  buildVolume: string | null;
  status: "AVAILABLE" | "PRINTING" | "MAINTENANCE" | "OFFLINE" | "RETIRED";
  purchasePrice: string | null;
  purchasedAt: Date | null;
  expectedLifetimeHours: number | null;
  powerWatts: number | null;
  maintenancePerHour: string | null;
  consumablesPerHour: string | null;
  hourlyRateOverride: string | null;
  initialPrintHours: string | null;
  location: string | null;
  notes: string | null;
  materialTypeIds: string[];
}

export async function savePrinter(userId: string, id: string | null, i: PrinterInput) {
  const data = {
    name: i.name,
    manufacturer: i.manufacturer,
    model: i.model,
    serialNumber: i.serialNumber,
    nozzleDiameterMm: i.nozzleDiameterMm ?? "0.4",
    nozzleNotes: i.nozzleNotes,
    hasMultiMaterial: i.hasMultiMaterial,
    buildVolume: i.buildVolume,
    status: i.status,
    purchasePrice: i.purchasePrice,
    purchasedAt: i.purchasedAt,
    expectedLifetimeHours: i.expectedLifetimeHours,
    powerWatts: i.powerWatts,
    maintenancePerHour: i.maintenancePerHour,
    consumablesPerHour: i.consumablesPerHour,
    hourlyRateOverride: i.hourlyRateOverride,
    initialPrintHours: i.initialPrintHours ?? "0",
    location: i.location,
    notes: i.notes,
  };
  return prisma.$transaction(async (tx) => {
    const p = id
      ? await tx.printer.update({ where: { id }, data: { ...data, supportedMaterialTypes: { set: i.materialTypeIds.map((m) => ({ id: m })) } } })
      : await tx.printer.create({ data: { ...data, supportedMaterialTypes: { connect: i.materialTypeIds.map((m) => ({ id: m })) } } });
    await audit(tx, { userId, entityType: "PRINTER", entityId: p.id, action: id ? "UPDATE" : "CREATE", summary: `${id ? "Updated" : "Added"} printer ${p.name}` });
    return p;
  });
}

export async function saveMaintenanceTask(
  userId: string,
  printerId: string,
  input: { id?: string | null; title: string; intervalPrintHours: number | null; intervalDays: number | null; notes: string | null },
) {
  if (!input.intervalPrintHours && !input.intervalDays) throw new ServiceError("Set an interval in print hours, days, or both.");
  const hours = (await printerHours([printerId])).get(printerId) ?? "0";
  return prisma.$transaction(async (tx) => {
    const t = input.id
      ? await tx.maintenanceTask.update({ where: { id: input.id }, data: { title: input.title, intervalPrintHours: input.intervalPrintHours, intervalDays: input.intervalDays, notes: input.notes } })
      : await tx.maintenanceTask.create({
          data: {
            printerId,
            title: input.title,
            intervalPrintHours: input.intervalPrintHours,
            intervalDays: input.intervalDays,
            notes: input.notes,
            lastDoneAt: new Date(),
            lastDonePrintHours: hours,
          },
        });
    await audit(tx, { userId, entityType: "PRINTER", entityId: printerId, action: "MAINTENANCE_TASK", summary: `${input.id ? "Updated" : "Scheduled"} maintenance "${t.title}"` });
    return t;
  });
}

export async function deleteMaintenanceTask(userId: string, taskId: string) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.maintenanceTask.update({ where: { id: taskId }, data: { isActive: false } });
    await audit(tx, { userId, entityType: "PRINTER", entityId: t.printerId, action: "MAINTENANCE_TASK_REMOVED", summary: `Removed maintenance "${t.title}"` });
  });
}

/** Records maintenance work; if tied to a scheduled task, resets its interval. Optionally books the cost as an expense. */
export async function logMaintenance(userId: string, printerId: string, input: { taskId: string | null; description: string; cost: string | null; performedAt: Date | null; recordExpense: boolean }) {
  const hours = (await printerHours([printerId])).get(printerId) ?? "0";
  return prisma.$transaction(async (tx) => {
    const printer = await tx.printer.findUnique({ where: { id: printerId } });
    if (!printer) throw new NotFoundError("Printer");
    const performedAt = input.performedAt ?? new Date();
    const log = await tx.maintenanceLog.create({ data: { printerId, taskId: input.taskId, description: input.description, cost: input.cost, performedAt, printHoursAt: hours } });
    if (input.taskId) await tx.maintenanceTask.update({ where: { id: input.taskId }, data: { lastDoneAt: performedAt, lastDonePrintHours: hours } });
    if (input.recordExpense && input.cost && dec(input.cost).gt(0))
      await tx.expense.create({ data: { date: performedAt, category: "MAINTENANCE", description: `${printer.name}: ${input.description}`, amount: input.cost, printerId } });
    await audit(tx, { userId, entityType: "PRINTER", entityId: printerId, action: "MAINTENANCE", summary: `Maintenance on ${printer.name}: ${input.description}` });
    return log;
  });
}

export async function printerOptions() {
  const ps = await prisma.printer.findMany({ where: { status: { not: "RETIRED" } }, orderBy: { name: "asc" }, include: { supportedMaterialTypes: { select: { code: true } } } });
  return ps.map((p) => ({ id: p.id, name: p.name, model: p.model, status: p.status, materialTypes: p.supportedMaterialTypes.map((m) => m.code), resolved: toResolvedPrinter(p) }));
}

/** All maintenance tasks currently due or overdue (for dashboard alerts). */
export async function dueMaintenance(): Promise<MaintenanceDue[]> {
  const printers = await prisma.printer.findMany({ where: { status: { not: "RETIRED" } }, include: { maintenanceTasks: { where: { isActive: true } } } });
  const hours = await printerHours(printers.map((p) => p.id));
  const out: MaintenanceDue[] = [];
  for (const p of printers)
    for (const t of p.maintenanceTasks) {
      const s = maintenanceStatus(t, hours.get(p.id) ?? "0");
      if (s.due) out.push({ taskId: t.id, printerId: p.id, printerName: p.name, title: t.title, dueReason: s.reason, overdue: s.overdue });
    }
  return out;
}
