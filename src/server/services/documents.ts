import "server-only";
import type { Tx } from "../db";
import { priceOrder } from "@/domain/pricing/engine";
import { dec } from "@/domain/money";
import type { OrderResult, PricingContext } from "@/domain/pricing/types";
import type { QuoteForm } from "@/domain/schemas/sales";
import { buildLineInput, resolveContext, type StoredLineInput } from "./pricing-inputs";

export function totalsColumns(result: OrderResult) {
  const t = result.totals;
  return {
    pricingSummary: JSON.parse(JSON.stringify({ totals: result.totals, costs: result.costs, grossProfit: result.grossProfit, marginPercent: result.marginPercent, markupPercent: result.markupPercent, issues: result.issues, steps: result.steps })),
    pricingComplete: result.complete,
    itemsNet: t?.itemsNet ?? "0",
    orderDiscount: t?.orderDiscount ?? "0",
    minimumAdjustment: t?.minimumAdjustment ?? "0",
    taxableAmount: t?.taxableAmount ?? "0",
    vatAmount: t?.vatAmount ?? "0",
    total: t?.total ?? "0",
    depositAmount: t?.depositAmount ?? "0",
    estimatedCost: result.costs?.total ?? "0",
    estimatedProfit: result.grossProfit ?? "0",
  };
}

/** Prices a document's lines and returns everything needed to persist it. */
export async function priceDocument(
  tx: Tx,
  form: Pick<QuoteForm, "lines" | "pricingPolicyId" | "refreshRates" | "orderDiscountType" | "orderDiscountValue" | "shippingCharge" | "shippingCost" | "depositPercent">,
  customerVatExempt: boolean,
  existing: { pricingContext: unknown; items: { id: string; materialId: string | null; supportMaterialId: string | null; printerId: string | null; pricingInput: unknown }[] } | null,
) {
  const ctx = await resolveContext(tx, { existing: (existing?.pricingContext as PricingContext) ?? null, policyId: form.pricingPolicyId, refresh: form.refreshRates });
  const existingById = new Map(existing?.items.map((i) => [i.id, i]) ?? []);
  const stored: StoredLineInput[] = [];
  for (const line of form.lines) stored.push(await buildLineInput(tx, line, line.id ? existingById.get(line.id) : undefined, form.refreshRates));
  const orderDiscount =
    form.orderDiscountType && form.orderDiscountValue !== null
      ? { type: form.orderDiscountType, value: form.orderDiscountType === "PERCENT" ? dec(form.orderDiscountValue).div(100).toString() : form.orderDiscountValue }
      : null;
  const result = priceOrder(
    { lines: stored, orderDiscount, shippingCharge: form.shippingCharge, shippingCost: form.shippingCost, depositPercent: form.depositPercent, customerVatExempt },
    ctx,
  );
  return { ctx, stored, result };
}

