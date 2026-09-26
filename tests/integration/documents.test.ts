import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { saveQuote } from "@/server/services/quotes";
import { saveOrder } from "@/server/services/orders";
import { recordPayment } from "@/server/services/payments";
import { deliveryNoteDocument, orderConfirmationDocument, paymentAckDocument, quoteDocument } from "@/server/services/customer-documents";
import { renderCustomerPdf } from "@/server/pdf/document";
import { orderForm, printLine, quoteForm, seedBasics } from "./helpers";

let base: Awaited<ReturnType<typeof seedBasics>>;
const SECRET_NOTE = "INTERNAL-ONLY-note-xyz";

beforeAll(async () => {
  base = await seedBasics();
  await prisma.customer.update({ where: { id: base.customer.id }, data: { name: "דנה לוי (Dana Levi)", addressLine1: "רחוב הרצל 10", city: "תל אביב" } });
});

function assertNoInternals(doc: unknown) {
  const json = JSON.stringify(doc);
  for (const forbidden of ["\"cost\"", "lineCost", "estimatedCost", "estimatedProfit", "margin", "markup", "profit", "machineRatePerHour", "pricingContext", SECRET_NOTE]) {
    expect(json, `document leaks ${forbidden}`).not.toContain(forbidden);
  }
}

describe("customer documents", () => {
  it("renders a quotation PDF with Hebrew text and no internal financials", async () => {
    const q = await saveQuote(base.user.id, null, quoteForm(base.customer.id, [printLine(base.material.id, base.printer.id, { modelingHours: "2", serviceType: "MODELING_AND_PRINTING" })], { internalNotes: SECRET_NOTE, customerNotes: "Thank you!" }));
    const doc = await quoteDocument(q.id);
    assertNoInternals(doc);
    expect(doc.totals.find(([k]) => k === "Total")?.[1]).toBe(q.total.toString());
    const pdf = await renderCustomerPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
    // Optional: write the sample for visual review (PDF_SAMPLE_OUT=/path/quote.pdf).
    if (process.env.PDF_SAMPLE_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);
  });

  it("renders order confirmation, delivery note and payment acknowledgement", async () => {
    const o = await saveOrder(base.user.id, null, orderForm(base.customer.id, [printLine(base.material.id, base.printer.id)], { confirm: true, internalNotes: SECRET_NOTE }));
    const p = await recordPayment(base.user.id, o.id, { kind: "PAYMENT", method: "BIT", amount: "50", isDeposit: true, receivedAt: null, reference: "BIT-123", feeAmount: "1.20", notes: null, idempotencyKey: null });
    for (const doc of [await orderConfirmationDocument(o.id), await deliveryNoteDocument(o.id), await paymentAckDocument(p.id)]) {
      assertNoInternals(doc);
      const pdf = await renderCustomerPdf(doc);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
    const delivery = await deliveryNoteDocument(o.id);
    expect(delivery.showPrices).toBe(false);
    expect(delivery.lines.every((l) => l.total === null && l.unitPrice === null)).toBe(true);
    const ack = await paymentAckDocument(p.id);
    expect(ack.disclaimer).toMatch(/not a tax invoice/);
  });
});
