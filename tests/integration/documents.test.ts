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
  // Empty strings (not nulls) in settings once made react-pdf drop the whole footer.
  await prisma.settings.update({ where: { id: 1 }, data: { documentFooter: "", legalName: "", businessTaxId: "" } });
  await prisma.customer.update({ where: { id: base.customer.id }, data: { name: "דנה לוי (Dana Levi)", addressLine1: "רחוב הרצל 10", city: "תל אביב" } });
});

/** Visible text of a rendered PDF (all pages), as a reader would see it. */
async function pdfText(pdf: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const doc = await task.promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await task.destroy();
  return text;
}

/** What the customer actually sees must carry the disclaimer and page footer, and no internals. */
async function assertRenderedDocument(pdf: Buffer, number: string) {
  const text = await pdfText(pdf);
  if (process.env.PDF_DEBUG) console.log("PDFTEXT>>", text.slice(-600));
  expect(text).toMatch(/not a tax (invoice|receipt)/i);
  expect(text).toContain(`${number} · page 1 of 1`);
  for (const forbidden of ["cost", "margin", "markup", "profit", SECRET_NOTE]) expect(text.toLowerCase(), `rendered PDF shows ${forbidden}`).not.toContain(forbidden.toLowerCase());
  return text;
}

function assertNoInternals(doc: unknown) {
  const json = JSON.stringify(doc);
  for (const forbidden of ['"cost"', "lineCost", "estimatedCost", "estimatedProfit", "margin", "markup", "profit", "machineRatePerHour", "pricingContext", SECRET_NOTE]) {
    expect(json, `document leaks ${forbidden}`).not.toContain(forbidden);
  }
}

describe("customer documents", () => {
  it("renders a quotation PDF with Hebrew text and no internal financials", async () => {
    const q = await saveQuote(
      base.user.id,
      null,
      quoteForm(base.customer.id, [printLine(base.material.id, base.printer.id, { modelingHours: "2", serviceType: "MODELING_AND_PRINTING" })], {
        internalNotes: SECRET_NOTE,
        customerNotes: "Thank you!",
      }),
    );
    const doc = await quoteDocument(q.id);
    assertNoInternals(doc);
    expect(doc.totals.find(([k]) => k === "Total")?.[1]).toBe(q.total.toString());
    const pdf = await renderCustomerPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
    const text = await assertRenderedDocument(pdf, doc.number);
    expect(text).toContain("Dana Levi");
    // Optional: write the sample for visual review (PDF_SAMPLE_OUT=/path/quote.pdf).
    if (process.env.PDF_SAMPLE_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);
  });

  it("renders order confirmation, delivery note and payment acknowledgement", async () => {
    const o = await saveOrder(base.user.id, null, orderForm(base.customer.id, [printLine(base.material.id, base.printer.id)], { confirm: true, internalNotes: SECRET_NOTE }));
    const p = await recordPayment(base.user.id, o.id, {
      kind: "PAYMENT",
      method: "BIT",
      amount: "50",
      isDeposit: true,
      receivedAt: null,
      reference: "BIT-123",
      feeAmount: "1.20",
      notes: null,
      idempotencyKey: null,
    });
    for (const doc of [await orderConfirmationDocument(o.id), await deliveryNoteDocument(o.id), await paymentAckDocument(p.id)]) {
      assertNoInternals(doc);
      const pdf = await renderCustomerPdf(doc);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      await assertRenderedDocument(pdf, doc.number);
    }
    const delivery = await deliveryNoteDocument(o.id);
    expect(delivery.showPrices).toBe(false);
    expect(delivery.lines.every((l) => l.total === null && l.unitPrice === null)).toBe(true);
    const ack = await paymentAckDocument(p.id);
    expect(ack.disclaimer).toMatch(/not a tax invoice/);
  });
});
