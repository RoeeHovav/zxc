import { z } from "zod";
import { checkbox, optDate, optDecimal, optId, optInt, optPercent, optText, reqDecimal, reqText } from "./common";

export const materialSchema = z.object({
  materialTypeId: reqText("Material type", 40),
  brand: reqText("Brand", 80),
  productLine: optText(80),
  colorName: reqText("Color", 60),
  colorHex: optText(9).refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v), "Use a hex color like #1a2b3c."),
  diameterMm: optDecimal({ min: 1, max: 3, label: "Diameter" }),
  densityGcm3: optDecimal({ min: 0.5, max: 3, label: "Density" }),
  pricePerKg: optDecimal({ min: 0, max: 100000, label: "Price per kg" }),
  wastePercent: optPercent("Waste allowance", 90),
  defaultSpoolNetG: optInt({ min: 1, max: 100000, label: "Spool net weight" }),
  emptySpoolWeightG: optInt({ min: 0, max: 5000, label: "Empty spool weight" }),
  minStockG: optInt({ min: 0, max: 1000000, label: "Minimum stock" }),
  sku: optText(60),
  supplierId: optId(),
  storageLocation: optText(80),
  notes: optText(2000),
  isActive: checkbox(),
});

export const receiveSchema = z.object({
  materialId: reqText("Material", 40),
  spoolCount: optInt({ min: 1, max: 200, label: "Number of spools" }).refine((v): v is number => v !== null, "Number of spools is required."),
  netWeightG: reqDecimal({ min: 1, max: 100000, label: "Net filament weight" }),
  pricePerSpool: reqDecimal({ min: 0, max: 100000, label: "Price per spool" }),
  shippingTotal: optDecimal({ min: 0, max: 100000, label: "Shipping" }),
  pricesIncludeVat: checkbox(),
  supplierId: optId(),
  purchasedAt: optDate(),
  storageLocation: optText(80),
  reference: optText(80),
  recordExpense: checkbox(),
  updateMaterialPrice: checkbox(),
});

export const PRINTER_STATUSES = ["AVAILABLE", "PRINTING", "MAINTENANCE", "OFFLINE", "RETIRED"] as const;

export const printerSchema = z.object({
  name: reqText("Name", 60),
  manufacturer: optText(60),
  model: reqText("Model", 80),
  serialNumber: optText(80),
  nozzleDiameterMm: optDecimal({ min: 0.1, max: 2, label: "Nozzle diameter" }),
  nozzleNotes: optText(200),
  hasMultiMaterial: checkbox(),
  buildVolume: optText(60),
  status: z.enum(PRINTER_STATUSES).default("AVAILABLE"),
  purchasePrice: optDecimal({ min: 0, max: 10000000, label: "Purchase price" }),
  purchasedAt: optDate(),
  expectedLifetimeHours: optInt({ min: 1, max: 1000000, label: "Expected lifetime" }),
  powerWatts: optInt({ min: 0, max: 10000, label: "Average power" }),
  maintenancePerHour: optDecimal({ min: 0, max: 10000, label: "Maintenance reserve" }),
  consumablesPerHour: optDecimal({ min: 0, max: 10000, label: "Consumables" }),
  hourlyRateOverride: optDecimal({ min: 0, max: 10000, label: "Hourly rate override" }),
  initialPrintHours: optDecimal({ min: 0, max: 1000000, label: "Existing print hours" }),
  location: optText(80),
  notes: optText(2000),
  materialTypeIds: z.array(z.string().max(40)).default([]),
});

export const maintenanceTaskSchema = z.object({
  id: optId(),
  title: reqText("Task", 120),
  intervalPrintHours: optInt({ min: 1, max: 100000, label: "Interval (hours)" }),
  intervalDays: optInt({ min: 1, max: 3650, label: "Interval (days)" }),
  notes: optText(500),
});

export const maintenanceLogSchema = z.object({
  taskId: optId(),
  description: reqText("Description", 300),
  cost: optDecimal({ min: 0, max: 1000000, label: "Cost" }),
  performedAt: optDate(),
  recordExpense: checkbox(),
});
