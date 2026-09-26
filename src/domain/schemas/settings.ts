import { z } from "zod";
import { checkbox, optDecimal, optInt, optPercent, optText, reqDecimal, reqText } from "./common";

const pctReq = (label: string, max = 100) => optPercent(label, max).refine((v): v is string => v !== null, `${label} is required.`);
const money = (label: string) => reqDecimal({ min: 0, max: 1000000, label });

export const settingsSchema = z.object({
  businessName: reqText("Business name", 120),
  legalName: optText(160),
  businessTaxId: optText(40),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(100),
  postalCode: optText(20),
  country: optText(80),
  phone: optText(40),
  email: optText(120),
  website: optText(200),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color."),
  vatMode: z.enum(["EXCLUSIVE", "EXEMPT"]),
  vatRate: pctReq("VAT rate", 50),
  electricityTariffPerKwh: reqDecimal({ min: 0, max: 100, label: "Electricity tariff" }),
  laborCostPerHour: money("Labor cost"),
  scannerCostPerHour: money("Scanner cost"),
  defaultMachineCostPerHour: money("Default machine cost"),
  defaultSetupMinutes: reqDecimal({ min: 0, max: 1000, label: "Setup minutes" }),
  materialWastePercent: pctReq("Material waste", 90),
  failureAllowancePercent: pctReq("Failure allowance", 90),
  contingencyPercent: pctReq("Contingency", 90),
  packingCostPerOrder: money("Packing cost"),
  transactionFeePercent: pctReq("Transaction fee", 20),
  transactionFeeFixed: money("Fixed transaction fee"),
  modelingRatePerHour: money("Modeling rate"),
  scanningRatePerHour: money("Scanning rate"),
  scanCleanupRatePerHour: money("Scan cleanup rate"),
  reverseEngineeringRatePerHour: money("Reverse engineering rate"),
  quoteValidityDays: optInt({ min: 1, max: 365, label: "Quote validity" }).refine((v): v is number => v !== null, "Quote validity is required."),
  defaultDepositPercent: pctReq("Default deposit"),
  requireDepositToProduce: checkbox(),
  defaultPaymentTerms: optText(1000),
  quoteTerms: optText(3000),
  documentFooter: optText(500),
  maxUploadMb: optInt({ min: 1, max: 2048, label: "Max upload size" }).refine((v): v is number => v !== null, "Required."),
  storageQuotaMb: optInt({ min: 10, max: 10000000, label: "Storage quota" }).refine((v): v is number => v !== null, "Required."),
});

export const policySchema = z
  .object({
    name: reqText("Name", 60),
    description: optText(300),
    method: z.enum(["MARKUP", "MARGIN"]),
    markupPercent: optPercent("Markup", 10000),
    marginPercent: optPercent("Margin", 99.99),
    minimumOrderCharge: optDecimal({ min: 0, max: 100000, label: "Minimum order charge" }),
    minimumMarginPercent: optPercent("Minimum margin", 99),
    priceRoundingStep: optDecimal({ min: 0, max: 1000, label: "Rounding step" }),
    roundingMode: z.enum(["UP", "NEAREST"]),
    isDefault: checkbox(),
  })
  .refine((v) => v.method !== "MARKUP" || v.markupPercent !== null, { message: "Enter the markup.", path: ["markupPercent"] })
  .refine((v) => v.method !== "MARGIN" || v.marginPercent !== null, { message: "Enter the target margin.", path: ["marginPercent"] });
