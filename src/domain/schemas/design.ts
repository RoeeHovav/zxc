import { z } from "zod";
import { checkbox, optDate, optDecimal, optId, optInt, optText, reqText } from "./common";

export const designSchema = z.object({
  customerId: reqText("Customer", 40),
  title: reqText("Title", 120),
  description: optText(3000),
  type: z.enum(["MODELING", "SCANNING", "SCAN_TO_CAD"]).default("MODELING"),
  complexity: z.enum(["SIMPLE", "MODERATE", "COMPLEX", "EXPERT"]).default("MODERATE"),
  estimatedHours: optDecimal({ min: 0, max: 10000, label: "Estimated hours" }),
  includedRevisions: optInt({ min: 0, max: 50, label: "Included revisions" }),
  feeMode: z.enum(["HOURLY", "FIXED"]).default("HOURLY"),
  fixedFee: optDecimal({ min: 0, max: 10000000, label: "Fixed fee" }),
  hourlyRate: optDecimal({ min: 0, max: 100000, label: "Hourly rate" }),
  additionalRevisionFee: optDecimal({ min: 0, max: 1000000, label: "Additional revision fee" }),
  ownership: z.enum(["CUSTOMER", "BUSINESS", "SHARED"]).default("CUSTOMER"),
  licenseNotes: optText(2000),
  dueDate: optDate(),
  defaultMaterialId: optId(),
  defaultPrinterId: optId(),
  defaultGramsPerUnit: optDecimal({ min: 0, max: 100000, label: "Grams per unit" }),
  defaultSupportGrams: optDecimal({ min: 0, max: 100000, label: "Support grams" }),
  defaultPrintMinutes: optDecimal({ min: 0, max: 100000, label: "Print minutes" }),
});

export const timeEntrySchema = z.object({
  category: z.enum(["MODELING", "SCANNING", "SCAN_CLEANUP", "REVERSE_ENGINEERING", "REVISION", "OTHER"]),
  hours: reqDecimalHours(),
  date: optDate(),
  billable: checkbox(),
  notes: optText(500),
});

function reqDecimalHours() {
  return optDecimal({ min: 0.01, max: 24, label: "Hours" }).refine((v): v is string => v !== null, "Hours are required.");
}
