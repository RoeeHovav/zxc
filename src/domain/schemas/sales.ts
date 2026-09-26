import { z } from "zod";
import { checkbox, optDate, optDecimal, optId, optInt, optPercent, optText, reqText } from "./common";

export const SERVICE_TYPES = ["PRINT_ONLY", "MODELING_AND_PRINTING", "MODELING_ONLY", "SCANNING_ONLY", "SCANNING_AND_PRINTING"] as const;
export type ServiceTypeValue = (typeof SERVICE_TYPES)[number];

/** One quote/order line as submitted by the editor (JSON). */
export const lineSchema = z.object({
  id: optId(),
  serviceType: z.enum(SERVICE_TYPES),
  partName: reqText("Part name", 120),
  description: optText(1000),
  category: optText(60),
  quantity: optInt({ min: 1, max: 1_000_000, label: "Quantity" }).refine((v): v is number => v !== null, "Quantity is required."),
  colorNote: optText(120),
  deadline: optDate(),
  specialInstructions: optText(1000),
  materialId: optId(),
  supportMaterialId: optId(),
  printerId: optId(),
  designProjectId: optId(),
  gramsPerUnit: optDecimal({ min: 0, max: 100000, label: "Grams per unit" }),
  supportGramsPerUnit: optDecimal({ min: 0, max: 100000, label: "Support grams" }),
  purgeGramsPerBatch: optDecimal({ min: 0, max: 100000, label: "Purge grams" }),
  unitsPerBatch: optInt({ min: 1, max: 100000, label: "Units per batch" }),
  printMinutesPerUnit: optDecimal({ min: 0, max: 100000, label: "Print minutes" }),
  setupMinutesPerBatch: optDecimal({ min: 0, max: 10000, label: "Setup minutes" }),
  postProcessMinutesPerUnit: optDecimal({ min: 0, max: 10000, label: "Post-processing minutes" }),
  extraCostPerUnit: optDecimal({ min: 0, max: 1000000, label: "Extra cost" }),
  extraCostNote: optText(120),
  modelingMode: z.enum(["HOURLY", "FIXED"]).nullish().transform((v) => v ?? "HOURLY"),
  modelingHours: optDecimal({ min: 0, max: 10000, label: "Modeling hours" }),
  modelingFee: optDecimal({ min: 0, max: 10000000, label: "Modeling fee" }),
  designFeeWaived: checkbox(),
  waivedReason: optText(200),
  scanHours: optDecimal({ min: 0, max: 10000, label: "Scan hours" }),
  scanCleanupHours: optDecimal({ min: 0, max: 10000, label: "Cleanup hours" }),
  reverseEngineeringHours: optDecimal({ min: 0, max: 10000, label: "Reverse-engineering hours" }),
  discountType: z.enum(["PERCENT", "AMOUNT"]).nullish().transform((v) => v ?? null),
  /** PERCENT as 0–100 in the editor; AMOUNT in currency. Converted server-side. */
  discountValue: optDecimal({ min: 0, max: 10000000, label: "Discount" }),
  manualUnitPrice: optDecimal({ min: 0, max: 10000000, label: "Manual unit price" }),
  manualPriceReason: optText(300),
});
export type LineForm = z.output<typeof lineSchema>;

const docBase = {
  customerId: reqText("Customer", 40),
  title: optText(120),
  pricingPolicyId: optId(),
  orderDiscountType: z.enum(["PERCENT", "AMOUNT"]).nullish().transform((v) => v ?? null),
  orderDiscountValue: optDecimal({ min: 0, max: 10000000, label: "Order discount" }),
  shippingMethod: optText(80),
  shippingCharge: optDecimal({ min: 0, max: 1000000, label: "Shipping charge" }),
  shippingCost: optDecimal({ min: 0, max: 1000000, label: "Shipping cost" }),
  depositPercent: optPercent("Deposit"),
  paymentTerms: optText(1000),
  customerNotes: optText(3000),
  internalNotes: optText(3000),
  refreshRates: checkbox(),
  lines: z.array(lineSchema).min(1, "Add at least one item.").max(200, "Too many items."),
};

export const quoteSchema = z.object({ ...docBase, validUntil: optDate(), requestedBy: optDate() });
export type QuoteForm = z.output<typeof quoteSchema>;

export const orderSchema = z.object({
  ...docBase,
  dueDate: optDate(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "RUSH"]).nullish().transform((v) => v ?? "NORMAL"),
  deliveryMethod: z.enum(["PICKUP", "COURIER", "POST", "OTHER"]).nullish().transform((v) => v ?? "PICKUP"),
  deliveryAddress: optText(300),
  confirm: checkbox(),
});
export type OrderForm = z.output<typeof orderSchema>;

export const paymentSchema = z.object({
  kind: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD", "BIT", "PAYBOX", "PAYPAL", "CHECK", "OTHER"]),
  amount: optDecimal({ min: 0.01, max: 10000000, label: "Amount" }).refine((v): v is string => v !== null, "Amount is required."),
  isDeposit: checkbox(),
  receivedAt: optDate(),
  reference: optText(120),
  feeAmount: optDecimal({ min: 0, max: 1000000, label: "Processing fee" }),
  notes: optText(500),
  /** Client-generated key that makes double submissions harmless. */
  idempotencyKey: optText(64),
});
export type PaymentForm = z.output<typeof paymentSchema>;
