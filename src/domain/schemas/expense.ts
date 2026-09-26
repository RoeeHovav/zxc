import { z } from "zod";
import { optDate, optDecimal, optId, optText, reqText } from "./common";

export const EXPENSE_CATEGORIES = ["MATERIALS", "EQUIPMENT", "MAINTENANCE", "CONSUMABLES", "SOFTWARE", "SHIPPING", "UTILITIES", "RENT", "MARKETING", "FEES", "PROFESSIONAL_SERVICES", "OTHER"] as const;

export const expenseSchema = z.object({
  date: optDate(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: reqText("Description", 200),
  supplierId: optId(),
  amount: optDecimal({ min: 0.01, max: 100000000, label: "Amount" }).refine((v): v is string => v !== null, "Amount is required."),
  vatAmount: optDecimal({ min: 0, max: 100000000, label: "VAT" }),
  paymentMethod: optText(20),
  reference: optText(80),
  printerId: optId(),
  orderId: optId(),
  notes: optText(1000),
});
