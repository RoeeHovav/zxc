/**
 * Pricing engine contracts. All decimal values are strings so inputs and
 * results can be snapshotted as JSON and reproduced exactly later.
 */

export type ServiceType =
  | "PRINT_ONLY"
  | "MODELING_AND_PRINTING"
  | "MODELING_ONLY"
  | "SCANNING_ONLY"
  | "SCANNING_AND_PRINTING";

export type PricingMethod = "MARKUP" | "MARGIN";
export type RoundingMode = "UP" | "NEAREST";
export type DiscountType = "PERCENT" | "AMOUNT";
export type VatMode = "EXCLUSIVE" | "EXEMPT";

/** Snapshot of every rate and policy used to price a document. */
export interface PricingContext {
  version: 1;
  capturedAt: string;
  currency: string;
  vatMode: VatMode;
  /** Fraction, e.g. "0.18" */
  vatRate: string;
  rates: {
    electricityTariffPerKwh: string;
    laborCostPerHour: string;
    scannerCostPerHour: string;
    defaultMachineCostPerHour: string;
    defaultSetupMinutes: string;
    materialWastePercent: string;
    failureAllowancePercent: string;
    contingencyPercent: string;
    packingCostPerOrder: string;
    transactionFeePercent: string;
    transactionFeeFixed: string;
    modelingRatePerHour: string;
    scanningRatePerHour: string;
    scanCleanupRatePerHour: string;
    reverseEngineeringRatePerHour: string;
  };
  policy: {
    id: string | null;
    name: string;
    method: PricingMethod;
    markupPercent: string;
    marginPercent: string;
    minimumOrderCharge: string;
    minimumMarginPercent: string;
    priceRoundingStep: string;
    roundingMode: RoundingMode;
  };
  defaultDepositPercent: string;
}

export interface ResolvedMaterial {
  id: string;
  label: string;
  /** null = unknown price; the engine refuses to price instead of assuming zero. */
  pricePerKg: string | null;
  wastePercent: string | null;
}

export interface ResolvedPrinter {
  id: string;
  name: string;
  hourlyRateOverride: string | null;
  purchasePrice: string | null;
  expectedLifetimeHours: string | null;
  powerWatts: string | null;
  maintenancePerHour: string | null;
  consumablesPerHour: string | null;
}

export interface PrintInput {
  material: ResolvedMaterial | null;
  /** Defaults to the primary material when null. */
  supportMaterial: ResolvedMaterial | null;
  printer: ResolvedPrinter | null;
  gramsPerUnit: string | null;
  supportGramsPerUnit: string | null;
  purgeGramsPerBatch: string | null;
  /** How many units are printed together in one job/plate. */
  unitsPerBatch: number;
  printMinutesPerUnit: string | null;
  /** null → context default */
  setupMinutesPerBatch: string | null;
  postProcessMinutesPerUnit: string | null;
  extraCostPerUnit: string | null;
  extraCostNote?: string | null;
}

export interface ModelingInput {
  mode: "HOURLY" | "FIXED";
  hours: string | null;
  fixedFee: string | null;
  /** True when re-ordering an existing design whose fee was already charged. */
  waived: boolean;
  waivedReason?: string | null;
}

export interface ScanningInput {
  scanHours: string | null;
  cleanupHours: string | null;
  reverseEngineeringHours: string | null;
}

export interface Discount {
  type: DiscountType;
  /** PERCENT: fraction 0–1. AMOUNT: currency amount. */
  value: string;
}

export interface LineInput {
  serviceType: ServiceType;
  quantity: number;
  print: PrintInput | null;
  modeling: ModelingInput | null;
  scanning: ScanningInput | null;
  discount: Discount | null;
  manualUnitPrice: { price: string; reason: string } | null;
}

export interface OrderInput {
  lines: LineInput[];
  orderDiscount: Discount | null;
  shippingCharge: string | null;
  shippingCost: string | null;
  /** Fraction; null → context default. */
  depositPercent: string | null;
  customerVatExempt: boolean;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface PricingIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  field?: string;
  /** Zero-based line index for line issues surfaced at order level. */
  line?: number;
}

export interface Step {
  key: string;
  label: string;
  formula: string;
  amount: string;
}

export interface ProductionResult {
  batches: number;
  grams: { model: string; support: string; purge: string; waste: string; total: string };
  machineHours: string;
  laborHours: string;
  machineRatePerHour: string;
  machineRateSource: "OVERRIDE" | "COMPONENTS" | "DEFAULT";
  costs: {
    material: string;
    supportMaterial: string;
    energy: string;
    depreciation: string;
    maintenance: string;
    consumables: string;
    machine: string;
    setupLabor: string;
    postProcessingLabor: string;
    extras: string;
    failureAllowance: string;
    subtotal: string;
    contingency: string;
    total: string;
  };
  unitCost: string;
  suggestedUnitPrice: string;
  unitPrice: string;
  priceSource: "POLICY" | "MANUAL";
  subtotal: string;
}

export interface ServicesResult {
  modeling: { mode: "HOURLY" | "FIXED"; hours: string | null; price: string; cost: string; waived: boolean } | null;
  scanning: {
    scanPrice: string;
    cleanupPrice: string;
    reverseEngineeringPrice: string;
    price: string;
    cost: string;
  } | null;
  price: string;
  cost: string;
}

export interface LineResult {
  complete: boolean;
  issues: PricingIssue[];
  quantity: number;
  production: ProductionResult | null;
  services: ServicesResult;
  /** Customer-facing amounts (net of VAT). null when the line is incomplete. */
  gross: string | null;
  discount: string | null;
  net: string | null;
  /** Estimated internal cost. */
  cost: string | null;
  profit: string | null;
  /** Gross margin on sales: profit ÷ net. */
  marginPercent: string | null;
  /** Markup on cost: profit ÷ cost. */
  markupPercent: string | null;
  steps: Step[];
}

export interface OrderResult {
  complete: boolean;
  issues: PricingIssue[];
  lines: LineResult[];
  totals: {
    itemsGross: string;
    lineDiscounts: string;
    itemsNet: string;
    orderDiscount: string;
    merchandiseNet: string;
    minimumAdjustment: string;
    shippingCharge: string;
    taxableAmount: string;
    vatRate: string;
    vatAmount: string;
    total: string;
    depositPercent: string;
    depositAmount: string;
  } | null;
  costs: {
    lines: string;
    shipping: string;
    packing: string;
    transactionFees: string;
    total: string;
  } | null;
  grossProfit: string | null;
  marginPercent: string | null;
  markupPercent: string | null;
  steps: Step[];
}
