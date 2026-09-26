"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Save, CheckCircle2, UserPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { priceOrder } from "@/domain/pricing/engine";
import { D } from "@/domain/money";
import { lineToEngineInput, parseDurationToMinutes, type LineFields } from "@/domain/pricing/from-form";
import type { PricingContext } from "@/domain/pricing/types";
import type { EditorOptions } from "@/server/services/editor";
import type { ActionResult } from "@/server/action";
import { enumLabel } from "@/lib/labels";
import { money, percent } from "@/lib/format";
import { LineCard } from "./line-card";
import type { EditorHeader, EditorInitial, EditorLine } from "./types";

const newKey = () => Math.random().toString(36).slice(2, 10);

export function blankLine(options: EditorOptions, previous?: EditorLine): EditorLine {
  const printer = previous?.printerId ? options.printers.find((p) => p.id === previous.printerId) : options.printers.find((p) => p.status !== "OFFLINE" && p.status !== "MAINTENANCE") ?? options.printers[0];
  const material = previous?.materialId ? options.materials.find((m) => m.id === previous.materialId) : undefined;
  return {
    key: newKey(),
    id: null,
    serviceType: "PRINT_ONLY",
    partName: "",
    description: "",
    category: "",
    quantity: "1",
    colorNote: "",
    deadline: "",
    specialInstructions: "",
    materialId: material?.id ?? null,
    supportMaterialId: null,
    printerId: printer?.id ?? null,
    designProjectId: null,
    gramsPerUnit: "",
    supportGramsPerUnit: "",
    purgeGramsPerBatch: "",
    unitsPerBatch: "1",
    printTime: "",
    setupMinutesPerBatch: "",
    postProcessMinutesPerUnit: "",
    extraCostPerUnit: "",
    extraCostNote: "",
    modelingMode: "HOURLY",
    modelingHours: "",
    modelingFee: "",
    designFeeWaived: false,
    waivedReason: "",
    scanHours: "",
    scanCleanupHours: "",
    reverseEngineeringHours: "",
    discountType: "",
    discountValue: "",
    manualUnitPrice: "",
    manualPriceReason: "",
    resolved: {
      material: material ? { id: material.id, label: material.label, pricePerKg: material.pricePerKg, wastePercent: material.wastePercent } : null,
      supportMaterial: null,
      printer: printer ? printer.resolved : null,
    },
    expanded: false,
  };
}

const n = (v: string) => (v.trim() === "" ? null : v.trim().replace(/,/g, ""));
/** Exact percent → fraction ("1.1" → "0.011"); unparseable input passes through so the engine reports it. */
const pctFrac = (v: string) => {
  try {
    return new D(v).div(100).toString();
  } catch {
    return v;
  }
};

function toFields(l: EditorLine): LineFields {
  const minutes = parseDurationToMinutes(l.printTime);
  return {
    serviceType: l.serviceType,
    quantity: Number(l.quantity || 0),
    gramsPerUnit: n(l.gramsPerUnit),
    supportGramsPerUnit: n(l.supportGramsPerUnit),
    purgeGramsPerBatch: n(l.purgeGramsPerBatch),
    unitsPerBatch: l.unitsPerBatch ? Number(l.unitsPerBatch) : null,
    printMinutesPerUnit: minutes === null ? null : String(minutes),
    setupMinutesPerBatch: n(l.setupMinutesPerBatch),
    postProcessMinutesPerUnit: n(l.postProcessMinutesPerUnit),
    extraCostPerUnit: n(l.extraCostPerUnit),
    extraCostNote: n(l.extraCostNote),
    modelingMode: l.modelingMode,
    modelingHours: n(l.modelingHours),
    modelingFee: n(l.modelingFee),
    designFeeWaived: l.designFeeWaived,
    waivedReason: n(l.waivedReason),
    scanHours: n(l.scanHours),
    scanCleanupHours: n(l.scanCleanupHours),
    reverseEngineeringHours: n(l.reverseEngineeringHours),
    discountType: l.discountType || null,
    discountValue: n(l.discountValue),
    manualUnitPrice: n(l.manualUnitPrice),
    manualPriceReason: n(l.manualPriceReason),
  };
}

function toPayloadLine(l: EditorLine) {
  const f = toFields(l);
  return {
    ...f,
    id: l.id,
    partName: l.partName,
    description: n(l.description),
    category: n(l.category),
    quantity: l.quantity,
    colorNote: n(l.colorNote),
    deadline: n(l.deadline),
    specialInstructions: n(l.specialInstructions),
    materialId: l.materialId,
    supportMaterialId: l.supportMaterialId,
    printerId: l.printerId,
    designProjectId: l.designProjectId,
    unitsPerBatch: l.unitsPerBatch || null,
    printMinutesPerUnit: f.printMinutesPerUnit,
    discountType: l.discountType || null,
  };
}

export function DocumentEditor({
  mode,
  id,
  options,
  initial,
  save,
  lockedLines,
}: {
  mode: "quote" | "order";
  id: string | null;
  options: EditorOptions;
  initial: EditorInitial | null;
  save: (payload: string, clientKey: string, intent: "draft" | "confirm") => Promise<ActionResult<{ id: string }>>;
  lockedLines?: Record<string, string>;
}) {
  const router = useRouter();
  const clientKey = React.useRef(`${mode}-${newKey()}${newKey()}`);
  const [header, setHeader] = React.useState<EditorHeader>(initial!.header);
  const [ctx, setCtx] = React.useState<PricingContext>(initial!.context);
  const [refreshRates, setRefreshRates] = React.useState(false);
  const [lines, setLines] = React.useState<EditorLine[]>(() => (initial!.lines.length ? initial!.lines.map((l) => ({ ...l, key: newKey(), expanded: false })) : [blankLine(options)]));
  const [pending, setPending] = React.useState<null | "draft" | "confirm">(null);
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const customer = options.customers.find((c) => c.id === header.customerId) ?? null;
  const policyId = header.pricingPolicyId ?? options.defaultPolicyId;
  const isConfirmed = mode === "order" && initial!.status !== "DRAFT";

  const priced = React.useMemo(
    () =>
      priceOrder(
        {
          lines: lines.map((l) => lineToEngineInput(toFields(l), l.resolved)),
          orderDiscount:
            header.orderDiscountType && n(header.orderDiscountValue)
              ? { type: header.orderDiscountType, value: header.orderDiscountType === "PERCENT" ? pctFrac(n(header.orderDiscountValue)!) : n(header.orderDiscountValue)! }
              : null,
          shippingCharge: n(header.shippingCharge),
          shippingCost: n(header.shippingCost),
          depositPercent: n(header.depositPercent) ? pctFrac(n(header.depositPercent)!) : null,
          customerVatExempt: customer?.vatExempt ?? false,
        },
        ctx,
      ),
    [lines, header.orderDiscountType, header.orderDiscountValue, header.shippingCharge, header.shippingCost, header.depositPercent, customer, ctx],
  );

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => setDirty(true);
  const setH = (patch: Partial<EditorHeader>) => {
    setHeader((h) => ({ ...h, ...patch }));
    touch();
  };
  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if (!("expanded" in patch && Object.keys(patch).length === 1)) touch();
  };
  const addLine = () => {
    setLines((ls) => [...ls, blankLine(options, ls[ls.length - 1])]);
    touch();
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-autofocus-line]");
      inputs[inputs.length - 1]?.focus();
    }, 30);
  };

  const changePolicy = (pid: string | null) => {
    const target = pid ?? options.defaultPolicyId;
    setH({ pricingPolicyId: pid });
    if (target !== ctx.policy.id) {
      setCtx(options.contexts[target]);
      setRefreshRates(true);
    }
  };

  const repriceCurrent = () => {
    setCtx(options.contexts[policyId]);
    setRefreshRates(true);
    setLines((ls) =>
      ls.map((l) => {
        const m = options.materials.find((x) => x.id === l.materialId);
        const sm = options.materials.find((x) => x.id === l.supportMaterialId);
        const p = options.printers.find((x) => x.id === l.printerId);
        return {
          ...l,
          resolved: {
            material: m ? { id: m.id, label: m.label, pricePerKg: m.pricePerKg, wastePercent: m.wastePercent } : l.resolved.material,
            supportMaterial: sm ? { id: sm.id, label: sm.label, pricePerKg: sm.pricePerKg, wastePercent: sm.wastePercent } : l.resolved.supportMaterial,
            printer: p ? p.resolved : l.resolved.printer,
          },
        };
      }),
    );
    touch();
    toast.info("Prices recalculated with current rates. Save to keep them.");
  };

  const submit = async (intent: "draft" | "confirm") => {
    if (pending) return;
    setPending(intent);
    setServerErrors({});
    setFormError(null);
    const payload = JSON.stringify({
      customerId: header.customerId ?? "",
      title: n(header.title),
      pricingPolicyId: header.pricingPolicyId,
      orderDiscountType: header.orderDiscountType || null,
      orderDiscountValue: n(header.orderDiscountValue),
      shippingMethod: n(header.shippingMethod),
      shippingCharge: n(header.shippingCharge),
      shippingCost: n(header.shippingCost),
      depositPercent: n(header.depositPercent),
      paymentTerms: n(header.paymentTerms),
      customerNotes: n(header.customerNotes),
      internalNotes: n(header.internalNotes),
      refreshRates,
      lines: lines.map(toPayloadLine),
      ...(mode === "quote"
        ? { validUntil: n(header.validUntil), requestedBy: n(header.requestedBy) }
        : { dueDate: n(header.dueDate), priority: header.priority, deliveryMethod: header.deliveryMethod, deliveryAddress: n(header.deliveryAddress), confirm: intent === "confirm" }),
    });
    try {
      const r = await save(payload, clientKey.current, intent);
      if (r.ok) {
        setDirty(false);
        toast.success(mode === "quote" ? "Quote saved." : intent === "confirm" ? "Order confirmed." : "Order saved.");
        router.push(`/${mode === "quote" ? "quotes" : "orders"}/${r.data.id}`);
        router.refresh();
      } else {
        setServerErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        toast.error(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      toast.error("Network error — nothing was saved. Try again.");
    } finally {
      setPending(null);
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void submit("draft");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lineErrors = (i: number) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(serverErrors)) {
      const m = /^lines\.(\d+)\.(.+)$/.exec(k);
      if (m && Number(m[1]) === i) out[m[2]] = v;
    }
    return out;
  };

  const t = priced.totals;
  const errorCount = priced.issues.filter((i) => i.severity === "error").length;
  const snapshotAge = ctx.capturedAt ? new Date(ctx.capturedAt) : null;
  const usingSnapshot = !!initial && !refreshRates && id !== null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 content-start gap-5">
        {formError && Object.keys(serverErrors).length === 0 && <Alert tone="danger" icon={TriangleAlert} title={formError} />}
        <Card>
          <CardContent className="grid gap-4 py-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="doc-customer">Customer</Label>
              <Combobox
                id="doc-customer"
                options={options.customers.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))}
                value={header.customerId}
                onChange={(v) => {
                  const c = options.customers.find((x) => x.id === v);
                  setH({ customerId: v, ...(mode === "order" && !header.deliveryAddress && c?.address ? { deliveryAddress: c.address } : {}) });
                  if (c?.pricingPolicyId && !header.pricingPolicyId && !isConfirmed) changePolicy(c.pricingPolicyId);
                }}
                placeholder="Choose customer…"
                searchPlaceholder="Name, phone, number…"
                invalid={!!serverErrors.customerId}
                footer={
                  <Link href={`/customers/new?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : `/${mode}s/new`)}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-primary hover:bg-accent">
                    <UserPlus className="size-3.5" /> New customer
                  </Link>
                }
              />
              {serverErrors.customerId && <p className="text-xs text-destructive">{serverErrors.customerId}</p>}
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="doc-title">Reference / title</Label>
              <Input id="doc-title" value={header.title} onChange={(e) => setH({ title: e.target.value })} placeholder="e.g. Drone frame parts" />
            </div>
            {mode === "quote" ? (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="doc-valid">Valid until</Label>
                  <Input id="doc-valid" type="date" value={header.validUntil} onChange={(e) => setH({ validUntil: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-req">Customer needs it by</Label>
                  <Input id="doc-req" type="date" value={header.requestedBy} onChange={(e) => setH({ requestedBy: e.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="doc-due">Due date</Label>
                  <Input id="doc-due" type="date" value={header.dueDate} onChange={(e) => setH({ dueDate: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-prio">Priority</Label>
                  <Select id="doc-prio" value={header.priority} onChange={(e) => setH({ priority: e.target.value as EditorHeader["priority"] })}>
                    {["LOW", "NORMAL", "HIGH", "RUSH"].map((p) => (
                      <option key={p} value={p}>
                        {enumLabel("priority", p)}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="doc-policy">Pricing policy</Label>
              <Select id="doc-policy" value={header.pricingPolicyId ?? ""} onChange={(e) => changePolicy(e.target.value || null)}>
                <option value="">Default ({options.policies.find((p) => p.id === options.defaultPolicyId)?.name})</option>
                {options.policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
          {usingSnapshot && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
              <span>Prices use the rates saved on {snapshotAge?.toLocaleDateString("en-GB")}. Changes to materials or settings since then are not applied.</span>
              <Button type="button" size="sm" variant="ghost" onClick={repriceCurrent}>
                <RefreshCw /> Re-price with current rates
              </Button>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          {lines.map((l, i) => (
            <LineCard
              key={l.key}
              index={i}
              line={l}
              result={priced.lines[i]}
              options={options}
              customerId={header.customerId}
              serverErrors={lineErrors(i)}
              canRemove={lines.length > 1 && !(l.id && lockedLines?.[l.id])}
              locked={l.id ? lockedLines?.[l.id] : null}
              onUpdate={(p) => updateLine(l.key, p)}
              onRemove={() => {
                setLines((ls) => ls.filter((x) => x.key !== l.key));
                touch();
              }}
              onDuplicate={() => {
                setLines((ls) => {
                  const idx = ls.findIndex((x) => x.key === l.key);
                  const copy = { ...l, key: newKey(), id: null, partName: `${l.partName} (copy)` };
                  return [...ls.slice(0, idx + 1), copy, ...ls.slice(idx + 1)];
                });
                touch();
              }}
              onMove={(dir) => {
                setLines((ls) => {
                  const idx = ls.findIndex((x) => x.key === l.key);
                  const j = idx + dir;
                  if (j < 0 || j >= ls.length) return ls;
                  const copy = [...ls];
                  [copy[idx], copy[j]] = [copy[j], copy[idx]];
                  return copy;
                });
                touch();
              }}
            />
          ))}
          <Button type="button" variant="secondary" onClick={addLine} className="w-full border-dashed py-6">
            <Plus /> Add item
          </Button>
        </div>

        <Card>
          <CardHeader title="Terms, shipping & notes" />
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1">
              <Label htmlFor="doc-odt">Order discount</Label>
              <Select id="doc-odt" value={header.orderDiscountType} onChange={(e) => setH({ orderDiscountType: e.target.value as EditorHeader["orderDiscountType"] })}>
                <option value="">None</option>
                <option value="PERCENT">Percent</option>
                <option value="AMOUNT">Amount</option>
              </Select>
            </div>
            {header.orderDiscountType && (
              <div className="grid gap-1">
                <Label htmlFor="doc-odv">Discount {header.orderDiscountType === "PERCENT" ? "(%)" : "(₪)"}</Label>
                <Input id="doc-odv" inputMode="decimal" value={header.orderDiscountValue} onChange={(e) => setH({ orderDiscountValue: e.target.value })} />
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="doc-dep">Deposit (%)</Label>
              <Input id="doc-dep" inputMode="decimal" value={header.depositPercent} onChange={(e) => setH({ depositPercent: e.target.value })} placeholder={new D(ctx.defaultDepositPercent).times(100).toString()} />
            </div>
            {mode === "order" && (
              <div className="grid gap-1">
                <Label htmlFor="doc-dm">Delivery</Label>
                <Select id="doc-dm" value={header.deliveryMethod} onChange={(e) => setH({ deliveryMethod: e.target.value as EditorHeader["deliveryMethod"] })}>
                  {["PICKUP", "COURIER", "POST", "OTHER"].map((d) => (
                    <option key={d} value={d}>
                      {enumLabel("deliveryMethod", d)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="doc-sm">Shipping method</Label>
              <Input id="doc-sm" value={header.shippingMethod} onChange={(e) => setH({ shippingMethod: e.target.value })} placeholder="Courier, post…" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="doc-sc">Shipping charged (₪)</Label>
              <Input id="doc-sc" inputMode="decimal" value={header.shippingCharge} onChange={(e) => setH({ shippingCharge: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="doc-scost">Shipping cost to you (₪)</Label>
              <Input id="doc-scost" inputMode="decimal" value={header.shippingCost} onChange={(e) => setH({ shippingCost: e.target.value })} />
            </div>
            {mode === "order" && header.deliveryMethod !== "PICKUP" && (
              <div className="grid gap-1 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="doc-addr">Delivery address</Label>
                <Input id="doc-addr" value={header.deliveryAddress} onChange={(e) => setH({ deliveryAddress: e.target.value })} />
              </div>
            )}
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="doc-terms">Payment terms (printed)</Label>
              <Textarea id="doc-terms" rows={2} value={header.paymentTerms} onChange={(e) => setH({ paymentTerms: e.target.value })} placeholder={options.settings.defaultPaymentTerms ?? ""} />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="doc-cn">Notes to customer (printed)</Label>
              <Textarea id="doc-cn" rows={2} value={header.customerNotes} onChange={(e) => setH({ customerNotes: e.target.value })} />
            </div>
            <div className="grid gap-1 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="doc-in">Internal notes (never printed)</Label>
              <Textarea id="doc-in" rows={2} value={header.internalNotes} onChange={(e) => setH({ internalNotes: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader title="Summary" description={`${lines.length} item(s) · ${ctx.policy.name} pricing`} />
          <CardContent className="grid gap-2 text-sm">
            {t ? (
              <>
                <Row label="Items" value={money(t.itemsGross)} />
                {Number(t.lineDiscounts) > 0 && <Row label="Line discounts" value={`−${money(t.lineDiscounts)}`} />}
                {Number(t.orderDiscount) > 0 && <Row label="Order discount" value={`−${money(t.orderDiscount)}`} />}
                {Number(t.minimumAdjustment) > 0 && <Row label="Minimum order adjustment" value={money(t.minimumAdjustment)} />}
                {Number(t.shippingCharge) > 0 && <Row label="Shipping" value={money(t.shippingCharge)} />}
                <Row label="Subtotal (excl. VAT)" value={money(t.taxableAmount)} strong />
                <Row label={`VAT ${percent(t.vatRate)}`} value={money(t.vatAmount)} />
                <div className="my-1 border-t border-border" />
                <Row label="Total" value={money(t.total)} big />
                {Number(t.depositAmount) > 0 && <Row label={`Deposit ${percent(t.depositPercent)}`} value={money(t.depositAmount)} />}
                <div className="mt-3 rounded-lg bg-muted p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Internal — not on documents</p>
                  <Row label="Estimated cost" value={money(priced.costs!.total)} />
                  <Row label="Gross profit" value={money(priced.grossProfit)} strong />
                  <Row label="Gross margin" value={percent(priced.marginPercent)} />
                  <Row label="Markup on cost" value={percent(priced.markupPercent)} />
                </div>
              </>
            ) : (
              <Alert tone="warning" icon={TriangleAlert} title={`${errorCount} issue(s) to resolve`}>
                Totals appear once every item has the information needed to price it. Nothing is guessed.
              </Alert>
            )}
            {priced.issues.filter((i) => i.line === undefined && i.severity !== "info").map((i, k) => (
              <p key={k} className={i.severity === "error" ? "text-xs text-destructive" : "text-xs text-warning"}>
                {i.message}
              </p>
            ))}
          </CardContent>
          <div className="grid gap-2 border-t border-border p-4">
            {mode === "order" && !isConfirmed ? (
              <>
                <Button type="button" size="lg" onClick={() => submit("confirm")} loading={pending === "confirm"} disabled={!!pending || !priced.complete}>
                  <CheckCircle2 /> Save & confirm order
                </Button>
                <Button type="button" variant="secondary" onClick={() => submit("draft")} loading={pending === "draft"} disabled={!!pending}>
                  <Save /> Save as draft
                </Button>
              </>
            ) : (
              <Button type="button" size="lg" onClick={() => submit("draft")} loading={!!pending} disabled={!!pending}>
                <Save /> {mode === "quote" ? "Save quote" : "Save changes"}
              </Button>
            )}
            <p className="text-center text-[11px] text-muted-foreground">Ctrl + S saves · prices are recalculated on the server</p>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function Row({ label, value, strong, big }: { label: string; value: string; strong?: boolean; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={big ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular ${big ? "text-xl font-semibold" : strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
