import "server-only";
import JSZip from "jszip";
import { prisma } from "../db";
import { toCsv, type Cell } from "@/domain/csv";
import { dec } from "@/domain/money";
import type { Period } from "./finance";
import { dailySeries, profitability } from "./reports";

type Table = { header: string[]; rows: Cell[][] };
const s = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString());

export const EXPORT_KINDS = ["customers", "orders", "order-items", "quotes", "payments", "expenses", "materials", "spools", "stock-movements", "jobs", "designs", "receivables", "profitability-orders", "profitability-customers", "profitability-materials", "profitability-printers", "daily"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export async function exportTable(kind: ExportKind, p?: Period): Promise<Table> {
  const range = p ? { gte: p.from, lt: p.to } : undefined;
  switch (kind) {
    case "customers": {
      const rows = await prisma.customer.findMany({ orderBy: { number: "asc" } });
      return {
        header: ["number", "name", "company", "email", "phone", "preferred_contact", "address1", "address2", "city", "postal_code", "country", "tax_id", "vat_exempt", "tags", "marketing_consent", "archived_at", "anonymized_at", "created_at", "notes"],
        rows: rows.map((c) => [c.number, c.name, c.company, c.email, c.phone, c.preferredContact, c.addressLine1, c.addressLine2, c.city, c.postalCode, c.country, c.taxId, c.vatExempt, c.tags.join("; "), c.marketingConsent, c.archivedAt, c.anonymizedAt, c.createdAt, c.notes]),
      };
    }
    case "orders": {
      const rows = await prisma.order.findMany({ where: range ? { orderDate: range } : {}, orderBy: { orderDate: "asc" }, include: { customer: { select: { number: true, name: true } }, quote: { select: { number: true } } } });
      return {
        header: ["number", "status", "customer_number", "customer", "quote", "order_date", "due_date", "confirmed_at", "delivered_at", "completed_at", "canceled_at", "items_net", "order_discount", "minimum_adjustment", "shipping_charge", "taxable_amount", "vat", "total", "deposit", "paid", "balance", "estimated_cost", "estimated_profit", "actual_cost", "revision", "delivery_method", "title"],
        rows: rows.map((o) => [o.number, o.status, o.customer.number, o.customer.name, o.quote?.number, o.orderDate, o.dueDate, o.confirmedAt, o.deliveredAt, o.completedAt, o.canceledAt, s(o.itemsNet), s(o.orderDiscount), s(o.minimumAdjustment), s(o.shippingCharge), s(o.taxableAmount), s(o.vatAmount), s(o.total), s(o.depositAmount), s(o.amountPaid), o.status === "CANCELED" ? dec(o.amountPaid.toString()).neg().toFixed(2) : dec(o.total.toString()).minus(dec(o.amountPaid.toString())).toFixed(2), s(o.estimatedCost), s(o.estimatedProfit), s(o.actualCost), o.revision, o.deliveryMethod, o.title]),
      };
    }
    case "order-items": {
      const rows = await prisma.orderItem.findMany({ where: range ? { order: { orderDate: range } } : {}, orderBy: [{ order: { number: "asc" } }, { position: "asc" }], include: { order: { select: { number: true } }, material: { select: { brand: true, colorName: true, materialType: { select: { code: true } } } }, printer: { select: { name: true } } } });
      return {
        header: ["order", "position", "service", "part", "quantity", "completed", "material", "printer", "unit_price", "line_net", "line_cost_estimated", "category", "description"],
        rows: rows.map((i) => [i.order.number, i.position + 1, i.serviceType, i.partName, i.quantity, i.quantityCompleted, i.material ? `${i.material.materialType.code} ${i.material.brand} ${i.material.colorName}` : null, i.printer?.name, s(i.unitPrice), s(i.lineNet), s(i.lineCost), i.category, i.description]),
      };
    }
    case "quotes": {
      const rows = await prisma.quote.findMany({ where: range ? { createdAt: range } : {}, orderBy: [{ number: "asc" }, { revision: "asc" }], include: { customer: { select: { name: true } }, order: { select: { number: true } } } });
      return {
        header: ["number", "revision", "status", "customer", "issued", "valid_until", "sent_at", "accepted_at", "rejected_at", "taxable_amount", "vat", "total", "estimated_cost", "estimated_profit", "order", "title"],
        rows: rows.map((q) => [q.number, q.revision, q.status, q.customer.name, q.issueDate, q.validUntil, q.sentAt, q.acceptedAt, q.rejectedAt, s(q.taxableAmount), s(q.vatAmount), s(q.total), s(q.estimatedCost), s(q.estimatedProfit), q.order?.number, q.title]),
      };
    }
    case "payments": {
      const rows = await prisma.payment.findMany({ where: range ? { receivedAt: range } : {}, orderBy: { receivedAt: "asc" }, include: { order: { select: { number: true } }, customer: { select: { number: true, name: true } } } });
      return {
        header: ["number", "kind", "date", "order", "customer_number", "customer", "method", "amount", "is_deposit", "processing_fee", "reference", "voided_at", "void_reason", "notes"],
        rows: rows.map((x) => [x.number, x.kind, x.receivedAt, x.order.number, x.customer.number, x.customer.name, x.method, x.kind === "REFUND" ? dec(x.amount.toString()).neg().toFixed(2) : s(x.amount), x.isDeposit, s(x.feeAmount), x.reference, x.voidedAt, x.voidReason, x.notes]),
      };
    }
    case "expenses": {
      const rows = await prisma.expense.findMany({ where: range ? { date: range } : {}, orderBy: { date: "asc" }, include: { supplier: { select: { name: true } }, printer: { select: { name: true } } } });
      return {
        header: ["date", "category", "description", "supplier", "amount_incl_vat", "vat", "payment_method", "reference", "printer", "notes"],
        rows: rows.map((e) => [e.date, e.category, e.description, e.supplier?.name, s(e.amount), s(e.vatAmount), e.paymentMethod, e.reference, e.printer?.name, e.notes]),
      };
    }
    case "materials": {
      const rows = await prisma.material.findMany({ include: { materialType: true, supplier: true } });
      return {
        header: ["type", "brand", "product_line", "color", "color_hex", "diameter_mm", "price_per_kg", "waste_override", "min_stock_g", "spool_net_g", "empty_spool_g", "sku", "supplier", "location", "active"],
        rows: rows.map((m) => [m.materialType.code, m.brand, m.productLine, m.colorName, m.colorHex, s(m.diameterMm), s(m.pricePerKg), s(m.wastePercent), m.minStockG, m.defaultSpoolNetG, m.emptySpoolWeightG, m.sku, m.supplier?.name, m.storageLocation, m.isActive]),
      };
    }
    case "spools": {
      const rows = await prisma.spool.findMany({ orderBy: { code: "asc" }, include: { material: { include: { materialType: true } } } });
      return {
        header: ["code", "material", "status", "net_g", "remaining_g", "measured", "last_weighed", "landed_cost", "purchased", "location"],
        rows: rows.map((x) => [x.code, `${x.material.materialType.code} ${x.material.brand} ${x.material.colorName}`, x.status, s(x.netWeightG), s(x.remainingG), x.remainingIsMeasured, x.lastWeighedAt, s(x.landedCost), x.purchasedAt, x.storageLocation]),
      };
    }
    case "stock-movements": {
      const rows = await prisma.stockMovement.findMany({ where: range ? { createdAt: range } : {}, orderBy: { createdAt: "asc" }, include: { material: { include: { materialType: true } }, spool: { select: { code: true } }, printJob: { select: { number: true } } } });
      return {
        header: ["date", "type", "material", "spool", "grams", "cost_per_kg", "job", "reason"],
        rows: rows.map((m) => [m.createdAt, m.type, `${m.material.materialType.code} ${m.material.brand} ${m.material.colorName}`, m.spool?.code, s(m.quantityG), s(m.costPerKg), m.printJob?.number, m.reason]),
      };
    }
    case "jobs": {
      const rows = await prisma.printJob.findMany({ where: range ? { createdAt: range } : {}, orderBy: { number: "asc" }, include: { order: { select: { number: true } }, printer: { select: { name: true } }, items: { include: { orderItem: { select: { partName: true } } } } } });
      return {
        header: ["number", "order", "status", "printer", "items", "estimated_min", "actual_min", "estimated_g", "actual_g", "started", "completed", "failure_reason", "reprint"],
        rows: rows.map((j) => [j.number, j.order.number, j.status, j.printer?.name, j.items.map((i) => `${i.quantity}x ${i.orderItem.partName}${i.quantityGood !== null ? ` (${i.quantityGood} good)` : ""}`).join("; "), s(j.estimatedMinutes), s(j.actualMinutes), s(j.estimatedGrams), s(j.actualGrams), j.startedAt, j.completedAt, j.failureReason, !!j.reprintOfId]),
      };
    }
    case "designs": {
      const rows = await prisma.designProject.findMany({ orderBy: { number: "asc" }, include: { customer: { select: { name: true } }, timeEntries: true, revisions: true } });
      return {
        header: ["number", "title", "customer", "type", "status", "complexity", "estimated_h", "logged_h", "revisions", "included_revisions", "fee_mode", "fixed_fee", "hourly_rate", "ownership", "license_notes"],
        rows: rows.map((d) => [d.number, d.title, d.customer.name, d.type, d.status, d.complexity, s(d.estimatedHours), d.timeEntries.reduce((a, t) => a.plus(dec(t.hours.toString())), dec(0)).toFixed(2), d.revisions.length, d.includedRevisions, d.feeMode, s(d.fixedFee), s(d.hourlyRate), d.ownership, d.licenseNotes]),
      };
    }
    case "receivables": {
      const rows = await prisma.order.findMany({ where: { status: { notIn: ["DRAFT", "CANCELED"] } }, include: { customer: { select: { name: true, phone: true } } }, orderBy: { orderDate: "asc" } });
      return {
        header: ["order", "status", "customer", "phone", "total", "paid", "balance", "due_date"],
        rows: rows
          .map((o) => ({ o, due: dec(o.total.toString()).minus(dec(o.amountPaid.toString())) }))
          .filter((x) => x.due.gt(0))
          .map(({ o, due }) => [o.number, o.status, o.customer.name, o.customer.phone, s(o.total), s(o.amountPaid), due.toFixed(2), o.dueDate]),
      };
    }
    case "profitability-orders":
    case "profitability-customers":
    case "profitability-materials":
    case "profitability-printers": {
      const r = await profitability(p ?? { from: new Date(0), to: new Date(8.64e15) });
      if (kind === "profitability-orders")
        return {
          header: ["order", "customer", "delivered", "revenue_excl_vat", "estimated_cost", "actual_cost", "variance", "profit", "margin"],
          rows: r.byOrder.map((o) => [o.number, o.customer, o.deliveredAt, o.revenue, o.estimatedCost, o.actualCost, o.variance, o.profit, o.margin]),
        };
      const list = kind === "profitability-customers" ? r.byCustomer : kind === "profitability-materials" ? r.byMaterial : r.byPrinter;
      return { header: ["name", "orders", "units", "grams", "machine_hours", "revenue", "cost", "profit", "margin"], rows: list.map((x) => [x.label, x.orders, x.units, x.grams, x.machineHours, x.revenue, x.cost, x.profit, x.margin]) };
    }
    case "daily": {
      const rows = await dailySeries(p ?? { from: new Date(0), to: new Date(8.64e15) });
      return { header: ["day", "orders_delivered", "revenue_excl_vat", "cogs", "gross_profit", "cash_received"], rows: rows.map((d) => [d.day, d.orders, d.revenue, d.cogs, d.grossProfit, d.cash]) };
    }
  }
}

export async function exportCsv(kind: ExportKind, p?: Period) {
  const t = await exportTable(kind, p);
  return toCsv(t.header, t.rows);
}

/** Complete, human-readable export: every table as CSV plus a JSON copy and a README. */
export async function fullExportZip(): Promise<Buffer> {
  const zip = new JSZip();
  const base = ["customers", "quotes", "orders", "order-items", "payments", "expenses", "materials", "spools", "stock-movements", "jobs", "designs"] as const;
  for (const k of base) zip.file(`csv/${k}.csv`, await exportCsv(k));
  const [settings, policies, printers, suppliers, audit] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.pricingPolicy.findMany(),
    prisma.printer.findMany({ include: { maintenanceTasks: true, maintenanceLogs: true } }),
    prisma.supplier.findMany(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  zip.file("json/settings.json", JSON.stringify({ settings, policies, printers, suppliers }, null, 2));
  zip.file("json/audit-log.json", JSON.stringify(audit, null, 2));
  const files = await prisma.fileAttachment.findMany({ select: { id: true, originalName: true, sizeBytes: true, sha256: true, customerId: true, orderId: true, quoteId: true, designProjectId: true, expenseId: true, createdAt: true } });
  zip.file("json/files-index.json", JSON.stringify(files, null, 2));
  zip.file(
    "README.txt",
    [
      "PrintForge full data export",
      `Created: ${new Date().toISOString()}`,
      "",
      "csv/     One CSV per table (UTF-8 with BOM; opens in Excel/LibreOffice/Google Sheets).",
      "json/    Settings, pricing policies, printers, suppliers, the audit log and an index of uploaded files.",
      "",
      "Uploaded files themselves are not included (they can be large); back up the UPLOAD_DIR folder",
      "together with the database (see docs/BACKUP.md). This export is for portability and review;",
      "use the database backup to restore the application.",
    ].join("\n"),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
