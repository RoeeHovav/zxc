import "server-only";
import { prisma } from "../db";
import type { LineResult, PricingContext } from "@/domain/pricing/types";
import { NotFoundError } from "./common";
import { getSettings } from "./settings";
import { readStoredFile } from "./files";
import { dec } from "@/domain/money";

/**
 * Customer-facing document data. Built from an explicit allow-list of fields so internal
 * cost, margin, profit, internal notes and pricing breakdowns can never reach a PDF.
 */
export interface CustomerDocument {
  kind: "QUOTE" | "ORDER_CONFIRMATION" | "DELIVERY_NOTE" | "PAYMENT_ACK";
  title: string;
  number: string;
  reference: string | null;
  issueDate: string;
  meta: [string, string][];
  business: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: string[];
    phone: string | null;
    email: string | null;
    website: string | null;
    brandColor: string;
    logo: { data: Buffer; format: "png" | "jpg" } | null;
  };
  customer: { name: string; company: string | null; taxId: string | null; address: string[]; phone: string | null; email: string | null };
  lines: { description: string; details: string[]; quantity: number | null; unitPrice: string | null; total: string | null }[];
  totals: [string, string, boolean?][];
  showPrices: boolean;
  notes: { title: string; body: string }[];
  footer: string | null;
  disclaimer: string;
  currency: string;
}

const NOT_TAX_DOC = "This document is not a tax invoice or tax receipt (חשבונית מס / קבלה).";

async function businessBlock() {
  const s = await getSettings();
  let logo: CustomerDocument["business"]["logo"] = null;
  if (s.logoFileId) {
    const f = await prisma.fileAttachment.findUnique({ where: { id: s.logoFileId } });
    if (f && ["png", "jpg", "jpeg"].includes(f.extension)) {
      try {
        logo = { data: await readStoredFile(f.storageKey), format: f.extension === "png" ? "png" : "jpg" };
      } catch {
        logo = null;
      }
    }
  }
  return {
    settings: s,
    business: {
      name: s.businessName,
      legalName: s.legalName,
      taxId: s.businessTaxId,
      address: [s.addressLine1, s.addressLine2, [s.postalCode, s.city].filter(Boolean).join(" "), s.country].filter((x): x is string => !!x),
      phone: s.phone,
      email: s.email,
      website: s.website,
      brandColor: /^#[0-9a-fA-F]{6}$/.test(s.brandColor) ? s.brandColor : "#4f46e5",
      logo,
    },
  };
}

function customerBlock(
  c: {
    name: string;
    company: string | null;
    taxId: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
  },
  overrideAddress?: string | null,
) {
  return {
    name: c.name,
    company: c.company,
    taxId: c.taxId,
    address: overrideAddress ? [overrideAddress] : [c.addressLine1, c.addressLine2, [c.postalCode, c.city].filter(Boolean).join(" ")].filter((x): x is string => !!x),
    phone: c.phone,
    email: c.email,
  };
}

const fmtDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d) : "");

type ItemLike = {
  partName: string;
  description: string | null;
  quantity: number;
  colorNote: string | null;
  specialInstructions: string | null;
  deadline: Date | null;
  serviceType: string;
  pricingResult: unknown;
  pricingInput: unknown;
};

const SERVICE_LABEL: Record<string, string> = {
  PRINT_ONLY: "3D printing",
  MODELING_AND_PRINTING: "3D modeling + printing",
  MODELING_ONLY: "3D modeling",
  SCANNING_ONLY: "3D scanning",
  SCANNING_AND_PRINTING: "3D scanning + printing",
};

/** Customer-safe line: description, qty, unit price, total. Service fees shown as detail rows. */
function customerLines(items: ItemLike[], showPrices: boolean): CustomerDocument["lines"] {
  const out: CustomerDocument["lines"] = [];
  for (const it of items) {
    const r = it.pricingResult as LineResult | null;
    const material = (it.pricingInput as { print?: { material?: { label: string } | null } | null })?.print?.material?.label;
    const details: string[] = [SERVICE_LABEL[it.serviceType] ?? it.serviceType];
    if (material) details.push(`Material: ${material.replace(/ · /g, " ")}`);
    if (it.colorNote) details.push(`Finish: ${it.colorNote}`);
    if (it.description) details.push(it.description);
    if (it.specialInstructions) details.push(`Instructions: ${it.specialInstructions}`);
    if (it.deadline) details.push(`Required by ${fmtDate(it.deadline)}`);
    if (showPrices && r?.services) {
      if (r.services.modeling && r.services.modeling.waived) details.push("Design: existing design reused (no design fee)");
      else if (r.services.modeling && Number(r.services.modeling.price) > 0) details.push(`Includes one-time modeling fee ${r.services.modeling.price}`);
      if (r.services.scanning) details.push(`Includes one-time scanning fee ${r.services.scanning.price}`);
    }
    if (showPrices && r?.discount && Number(r.discount) > 0) details.push(`Discount −${r.discount}`);
    const unit = r?.production ? r.production.unitPrice : null;
    out.push({ description: it.partName, details, quantity: it.quantity, unitPrice: showPrices ? unit : null, total: showPrices ? (r?.net ?? null) : null });
  }
  return out;
}

type TotalsLike = {
  itemsNet: { toString(): string };
  orderDiscount: { toString(): string };
  minimumAdjustment: { toString(): string };
  shippingCharge: { toString(): string };
  taxableAmount: { toString(): string };
  vatAmount: { toString(): string };
  total: { toString(): string };
  depositAmount: { toString(): string };
  pricingContext: unknown;
};

function totalsRows(d: TotalsLike): [string, string, boolean?][] {
  const ctx = d.pricingContext as PricingContext;
  const rows: [string, string, boolean?][] = [["Items", d.itemsNet.toString()]];
  if (Number(d.orderDiscount) > 0) rows.push(["Discount", `−${d.orderDiscount.toString()}`]);
  if (Number(d.minimumAdjustment) > 0) rows.push(["Minimum order adjustment", d.minimumAdjustment.toString()]);
  if (Number(d.shippingCharge) > 0) rows.push(["Shipping", d.shippingCharge.toString()]);
  if (ctx.vatMode === "EXCLUSIVE") {
    rows.push(["Subtotal before VAT", d.taxableAmount.toString()]);
    rows.push([Number(d.vatAmount) > 0 ? `VAT ${(Number(ctx.vatRate) * 100).toFixed(0)}%` : "VAT (exempt)", d.vatAmount.toString()]);
  }
  rows.push(["Total", d.total.toString(), true]);
  return rows;
}

export async function quoteDocument(id: string): Promise<CustomerDocument> {
  const q = await prisma.quote.findUnique({ where: { id }, include: { customer: true, items: { orderBy: { position: "asc" } } } });
  if (!q) throw new NotFoundError("Quote");
  const { business, settings } = await businessBlock();
  const totals = totalsRows(q);
  if (Number(q.depositAmount) > 0) totals.push(["Deposit required to start", q.depositAmount.toString()]);
  return {
    kind: "QUOTE",
    title: "Quotation",
    number: q.revision > 1 ? `${q.number} rev ${q.revision}` : q.number,
    reference: q.title,
    issueDate: fmtDate(q.sentAt ?? q.issueDate),
    meta: [["Valid until", fmtDate(q.validUntil)], ...(q.requestedBy ? ([["Requested by", fmtDate(q.requestedBy)]] as [string, string][]) : [])],
    business,
    customer: customerBlock(q.customer),
    lines: customerLines(q.items, true),
    totals,
    showPrices: true,
    notes: [
      ...(q.customerNotes ? [{ title: "Notes", body: q.customerNotes }] : []),
      ...(q.paymentTerms ? [{ title: "Payment terms", body: q.paymentTerms }] : []),
      ...(settings.quoteTerms ? [{ title: "Terms", body: settings.quoteTerms }] : []),
    ],
    footer: settings.documentFooter,
    disclaimer: `Prices in ${q.currency}. ${NOT_TAX_DOC}`,
    currency: q.currency,
  };
}

async function loadOrder(id: string) {
  const o = await prisma.order.findUnique({ where: { id }, include: { customer: true, items: { orderBy: { position: "asc" } } } });
  if (!o) throw new NotFoundError("Order");
  return o;
}

export async function orderConfirmationDocument(id: string): Promise<CustomerDocument> {
  const o = await loadOrder(id);
  const { business, settings } = await businessBlock();
  const totals = totalsRows(o);
  if (Number(o.amountPaid) !== 0) totals.push(["Paid to date", o.amountPaid.toString()]);
  totals.push(["Balance due", o.status === "CANCELED" ? "0.00" : dec(o.total.toString()).minus(dec(o.amountPaid.toString())).toFixed(2), true]);
  return {
    kind: "ORDER_CONFIRMATION",
    title: o.status === "DRAFT" ? "Order (draft)" : "Order confirmation",
    number: o.number,
    reference: o.title,
    issueDate: fmtDate(o.confirmedAt ?? o.orderDate),
    meta: [
      ...(o.dueDate ? ([["Expected by", fmtDate(o.dueDate)]] as [string, string][]) : []),
      ["Delivery", o.deliveryMethod === "PICKUP" ? "Pickup" : o.deliveryMethod === "COURIER" ? "Courier" : o.deliveryMethod === "POST" ? "Post" : "Other"],
      ...(Number(o.depositAmount) > 0 ? ([["Deposit required", o.depositAmount.toString()]] as [string, string][]) : []),
    ],
    business,
    customer: customerBlock(o.customer, o.deliveryMethod !== "PICKUP" ? o.deliveryAddress : null),
    lines: customerLines(o.items, true),
    totals,
    showPrices: true,
    notes: [...(o.customerNotes ? [{ title: "Notes", body: o.customerNotes }] : []), ...(o.paymentTerms ? [{ title: "Payment terms", body: o.paymentTerms }] : [])],
    footer: settings.documentFooter,
    disclaimer: `Amounts in ${o.currency}. ${NOT_TAX_DOC}`,
    currency: o.currency,
  };
}

export async function deliveryNoteDocument(id: string): Promise<CustomerDocument> {
  const o = await loadOrder(id);
  const { business, settings } = await businessBlock();
  return {
    kind: "DELIVERY_NOTE",
    title: "Delivery note",
    number: o.deliveryNoteNumber ?? `${o.number} (delivery)`,
    reference: o.title,
    issueDate: fmtDate(o.deliveredAt ?? new Date()),
    meta: [["Order", o.number]],
    business,
    customer: customerBlock(o.customer, o.deliveryAddress),
    lines: customerLines(o.items, false),
    totals: [],
    showPrices: false,
    notes: [
      { title: "Received by", body: "Name: ______________________     Signature: ______________________     Date: ____________" },
      ...(o.customerNotes ? [{ title: "Notes", body: o.customerNotes }] : []),
    ],
    footer: settings.documentFooter,
    disclaimer: "Goods delivered as listed above. This delivery note is not a tax invoice.",
    currency: o.currency,
  };
}

export async function paymentAckDocument(paymentId: string): Promise<CustomerDocument> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { customer: true } } } });
  if (!p) throw new NotFoundError("Payment");
  const { business, settings } = await businessBlock();
  const o = p.order;
  const method: Record<string, string> = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", CREDIT_CARD: "Credit card", BIT: "Bit", PAYBOX: "PayBox", PAYPAL: "PayPal", CHECK: "Check", OTHER: "Other" };
  return {
    kind: "PAYMENT_ACK",
    title: p.voidedAt ? "Payment acknowledgement (VOID)" : "Payment acknowledgement",
    number: p.number,
    reference: null,
    issueDate: fmtDate(p.receivedAt),
    meta: [["Order", o.number], ["Method", method[p.method] ?? p.method], ...(p.reference ? ([["Reference", p.reference]] as [string, string][]) : [])],
    business,
    customer: customerBlock(o.customer),
    lines: [{ description: `${p.isDeposit ? "Deposit" : "Payment"} for order ${o.number}`, details: o.title ? [o.title] : [], quantity: null, unitPrice: null, total: p.amount.toString() }],
    totals: [
      ["Amount received", p.amount.toString(), true],
      ["Order total", o.total.toString()],
      ["Paid to date", o.amountPaid.toString()],
      ["Balance due", o.status === "CANCELED" ? "0.00" : dec(o.total.toString()).minus(dec(o.amountPaid.toString())).toFixed(2)],
    ],
    showPrices: true,
    notes: [],
    footer: settings.documentFooter,
    disclaimer: `Acknowledges receipt of payment only. ${NOT_TAX_DOC} A legally valid receipt must be issued from a certified invoicing system.`,
    currency: o.currency,
  };
}
