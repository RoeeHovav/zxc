import type { PricingContext, ResolvedMaterial, ResolvedPrinter, ServiceType } from "@/domain/pricing/types";
import type { Resolved } from "@/domain/pricing/from-form";

export interface EditorLine {
  key: string;
  id: string | null;
  serviceType: ServiceType;
  partName: string;
  description: string;
  category: string;
  quantity: string;
  colorNote: string;
  deadline: string;
  specialInstructions: string;
  materialId: string | null;
  supportMaterialId: string | null;
  printerId: string | null;
  designProjectId: string | null;
  gramsPerUnit: string;
  supportGramsPerUnit: string;
  purgeGramsPerBatch: string;
  unitsPerBatch: string;
  printTime: string;
  setupMinutesPerBatch: string;
  postProcessMinutesPerUnit: string;
  extraCostPerUnit: string;
  extraCostNote: string;
  modelingMode: "HOURLY" | "FIXED";
  modelingHours: string;
  modelingFee: string;
  designFeeWaived: boolean;
  waivedReason: string;
  scanHours: string;
  scanCleanupHours: string;
  reverseEngineeringHours: string;
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
  manualUnitPrice: string;
  manualPriceReason: string;
  resolved: Resolved;
  expanded: boolean;
}

export interface EditorHeader {
  customerId: string | null;
  title: string;
  pricingPolicyId: string | null;
  validUntil: string;
  requestedBy: string;
  dueDate: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "RUSH";
  deliveryMethod: "PICKUP" | "COURIER" | "POST" | "OTHER";
  deliveryAddress: string;
  orderDiscountType: "" | "PERCENT" | "AMOUNT";
  orderDiscountValue: string;
  shippingMethod: string;
  shippingCharge: string;
  shippingCost: string;
  depositPercent: string;
  paymentTerms: string;
  customerNotes: string;
  internalNotes: string;
}

export interface EditorInitial {
  header: EditorHeader;
  lines: Omit<EditorLine, "key" | "expanded">[];
  context: PricingContext;
  status: string;
}

export type { ResolvedMaterial, ResolvedPrinter };
