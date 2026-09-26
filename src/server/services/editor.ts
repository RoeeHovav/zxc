import "server-only";
import type { EditorHeader, EditorInitial, EditorLine } from "@/components/editor/types";
import type { StoredLineInput } from "./pricing-inputs";
import { formatMinutes } from "@/domain/pricing/from-form";
import { isoDate } from "@/lib/format";
import { D } from "@/domain/money";
import { prisma } from "../db";
import type { PricingContext } from "@/domain/pricing/types";
import { materialOptions } from "./materials";
import { printerOptions } from "./printers";
import { buildPricingContext, getDefaultPolicy, getSettings, listPolicies } from "./settings";

/** Everything the quote/order editor needs, as plain serializable data. */
export async function editorOptions() {
  const settings = await getSettings();
  await getDefaultPolicy();
  const [customers, materials, printers, policies, designs] = await Promise.all([
    prisma.customer.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, number: true, name: true, company: true, phone: true, vatExempt: true, pricingPolicyId: true, addressLine1: true, addressLine2: true, city: true, postalCode: true },
    }),
    materialOptions(),
    printerOptions(),
    listPolicies(),
    prisma.designProject.findMany({
      where: { status: { in: ["APPROVED", "DELIVERED"] } },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { id: true, number: true, title: true, customerId: true, status: true, defaultMaterialId: true, defaultPrinterId: true, defaultGramsPerUnit: true, defaultSupportGrams: true, defaultPrintMinutes: true },
    }),
  ]);
  const contexts: Record<string, PricingContext> = {};
  for (const p of policies) contexts[p.id] = buildPricingContext(settings, p);
  const defaultPolicy = policies.find((p) => p.isDefault) ?? policies[0];
  return {
    customers: customers.map((c) => ({
      id: c.id,
      label: c.company ? `${c.name} (${c.company})` : c.name,
      hint: [c.number, c.phone].filter(Boolean).join(" · "),
      vatExempt: c.vatExempt,
      pricingPolicyId: c.pricingPolicyId,
      address: [c.addressLine1, c.addressLine2, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    })),
    materials,
    printers: printers.map((p) => ({ id: p.id, name: p.name, model: p.model, status: p.status, materialTypes: p.materialTypes, resolved: p.resolved })),
    policies: policies.map((p) => ({ id: p.id, name: p.name })),
    contexts,
    defaultPolicyId: defaultPolicy.id,
    designs: designs.map((d) => ({
      ...d,
      defaultGramsPerUnit: d.defaultGramsPerUnit?.toString() ?? null,
      defaultSupportGrams: d.defaultSupportGrams?.toString() ?? null,
      defaultPrintMinutes: d.defaultPrintMinutes?.toString() ?? null,
    })),
    settings: { quoteValidityDays: settings.quoteValidityDays, vatMode: settings.vatMode, defaultPaymentTerms: settings.defaultPaymentTerms },
  };
}

export type EditorOptions = Awaited<ReturnType<typeof editorOptions>>;


type DocLike = {
  customerId: string;
  title: string | null;
  pricingPolicyId: string | null;
  pricingContext: unknown;
  orderDiscountType: "PERCENT" | "AMOUNT" | null;
  orderDiscountValue: { toString(): string } | null;
  shippingMethod: string | null;
  shippingCharge: { toString(): string };
  shippingCost: { toString(): string };
  depositPercent: { toString(): string } | null;
  paymentTerms: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  status: string;
  items: { id: string; pricingInput: unknown }[];
  validUntil?: Date | null;
  requestedBy?: Date | null;
  dueDate?: Date | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "RUSH";
  deliveryMethod?: "PICKUP" | "COURIER" | "POST" | "OTHER";
  deliveryAddress?: string | null;
};

const str = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : v.toString());
const zeroBlank = (v: { toString(): string } | null | undefined) => (v === null || v === undefined || Number(v.toString()) === 0 ? "" : v.toString());
const pct100 = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : new D(v.toString()).times(100).toString());

function editorLineFromStored(id: string | null, stored: StoredLineInput): Omit<EditorLine, "key" | "expanded"> {
  const f = stored.form;
  return {
    id,
    serviceType: f.serviceType,
    partName: f.partName,
    description: f.description ?? "",
    category: f.category ?? "",
    quantity: String(f.quantity),
    colorNote: f.colorNote ?? "",
    deadline: f.deadline ? isoDate(f.deadline) : "",
    specialInstructions: f.specialInstructions ?? "",
    materialId: f.materialId,
    supportMaterialId: f.supportMaterialId,
    printerId: f.printerId,
    designProjectId: f.designProjectId,
    gramsPerUnit: f.gramsPerUnit ?? "",
    supportGramsPerUnit: f.supportGramsPerUnit ?? "",
    purgeGramsPerBatch: f.purgeGramsPerBatch ?? "",
    unitsPerBatch: f.unitsPerBatch ? String(f.unitsPerBatch) : "1",
    printTime: f.printMinutesPerUnit ? formatMinutes(f.printMinutesPerUnit) : "",
    setupMinutesPerBatch: f.setupMinutesPerBatch ?? "",
    postProcessMinutesPerUnit: f.postProcessMinutesPerUnit ?? "",
    extraCostPerUnit: f.extraCostPerUnit ?? "",
    extraCostNote: f.extraCostNote ?? "",
    modelingMode: f.modelingMode ?? "HOURLY",
    modelingHours: f.modelingHours ?? "",
    modelingFee: f.modelingFee ?? "",
    designFeeWaived: !!f.designFeeWaived,
    waivedReason: f.waivedReason ?? "",
    scanHours: f.scanHours ?? "",
    scanCleanupHours: f.scanCleanupHours ?? "",
    reverseEngineeringHours: f.reverseEngineeringHours ?? "",
    discountType: f.discountType ?? "",
    discountValue: f.discountValue ?? "",
    manualUnitPrice: f.manualUnitPrice ?? "",
    manualPriceReason: f.manualPriceReason ?? "",
    resolved: { material: stored.print?.material ?? null, supportMaterial: stored.print?.supportMaterial ?? null, printer: stored.print?.printer ?? null },
  };
}

/** Editor state for an existing document (keeps its pricing snapshot). */
export function editorInitialFromDoc(doc: DocLike): EditorInitial {
  const header: EditorHeader = {
    customerId: doc.customerId,
    title: doc.title ?? "",
    pricingPolicyId: doc.pricingPolicyId,
    validUntil: isoDate(doc.validUntil ?? null),
    requestedBy: isoDate(doc.requestedBy ?? null),
    dueDate: isoDate(doc.dueDate ?? null),
    priority: doc.priority ?? "NORMAL",
    deliveryMethod: doc.deliveryMethod ?? "PICKUP",
    deliveryAddress: doc.deliveryAddress ?? "",
    orderDiscountType: doc.orderDiscountType ?? "",
    orderDiscountValue: str(doc.orderDiscountValue),
    shippingMethod: doc.shippingMethod ?? "",
    shippingCharge: zeroBlank(doc.shippingCharge),
    shippingCost: zeroBlank(doc.shippingCost),
    depositPercent: pct100(doc.depositPercent),
    paymentTerms: doc.paymentTerms ?? "",
    customerNotes: doc.customerNotes ?? "",
    internalNotes: doc.internalNotes ?? "",
  };
  return {
    header,
    lines: doc.items.map((it) => editorLineFromStored(it.id, it.pricingInput as StoredLineInput)),
    context: doc.pricingContext as PricingContext,
    status: doc.status,
  };
}

/** A brand-new document, optionally copying lines from an existing one (priced at current rates). */
export function editorInitialBlank(options: EditorOptions, mode: "quote" | "order", customerId: string | null, copyFrom?: DocLike | null): EditorInitial {
  const customer = options.customers.find((c) => c.id === customerId);
  const policyId = copyFrom?.pricingPolicyId && options.contexts[copyFrom.pricingPolicyId] ? copyFrom.pricingPolicyId : customer?.pricingPolicyId ?? null;
  const base = copyFrom ? editorInitialFromDoc(copyFrom) : null;
  const header: EditorHeader = {
    customerId: customerId ?? base?.header.customerId ?? null,
    title: base?.header.title ?? "",
    pricingPolicyId: policyId,
    validUntil: mode === "quote" ? isoDate(new Date(Date.now() + options.settings.quoteValidityDays * 86400000)) : "",
    requestedBy: "",
    dueDate: "",
    priority: "NORMAL",
    deliveryMethod: base?.header.deliveryMethod ?? "PICKUP",
    deliveryAddress: customer?.address ?? base?.header.deliveryAddress ?? "",
    orderDiscountType: base?.header.orderDiscountType ?? "",
    orderDiscountValue: base?.header.orderDiscountValue ?? "",
    shippingMethod: base?.header.shippingMethod ?? "",
    shippingCharge: base?.header.shippingCharge ?? "",
    shippingCost: base?.header.shippingCost ?? "",
    depositPercent: base?.header.depositPercent ?? "",
    paymentTerms: base?.header.paymentTerms ?? "",
    customerNotes: base?.header.customerNotes ?? "",
    internalNotes: "",
  };
  const ctx = options.contexts[policyId ?? options.defaultPolicyId];
  // Copied lines are re-resolved against the current catalog (new document → current rates).
  const lines = (base?.lines ?? []).map((l) => {
    const m = options.materials.find((x) => x.id === l.materialId);
    const sm = options.materials.find((x) => x.id === l.supportMaterialId);
    const p = options.printers.find((x) => x.id === l.printerId);
    return {
      ...l,
      id: null,
      designFeeWaived: l.designFeeWaived || (l.serviceType === "MODELING_AND_PRINTING" && !!l.designProjectId),
      waivedReason: l.waivedReason || (l.designProjectId ? "Re-order of an existing design" : ""),
      resolved: {
        material: m ? { id: m.id, label: m.label, pricePerKg: m.pricePerKg, wastePercent: m.wastePercent } : null,
        supportMaterial: sm ? { id: sm.id, label: sm.label, pricePerKg: sm.pricePerKg, wastePercent: sm.wastePercent } : null,
        printer: p ? p.resolved : null,
      },
      materialId: m ? l.materialId : null,
      printerId: p ? l.printerId : null,
    };
  });
  return { header, lines, context: ctx, status: "DRAFT" };
}
