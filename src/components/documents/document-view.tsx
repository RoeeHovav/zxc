import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { LineResult } from "@/domain/pricing/types";
import { enumLabel } from "@/lib/labels";
import { grams, minutesToHuman, money, percent } from "@/lib/format";

export interface ViewLine {
  id: string;
  partName: string;
  description: string | null;
  serviceType: string;
  quantity: number;
  colorNote: string | null;
  result: LineResult | null;
  materialLabel: string | null;
  colorHex: string | null;
  printerName: string | null;
  design: { id: string; number: string; title: string } | null;
  progress?: React.ReactNode;
}

export function DocumentLines({ items }: { items: ViewLine[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Item</TH>
          <TH className="text-end">Qty</TH>
          <TH className="hidden text-end sm:table-cell">Unit</TH>
          <TH className="text-end">Total</TH>
          <TH className="hidden text-end lg:table-cell">Cost*</TH>
          <TH className="hidden text-end lg:table-cell">Margin*</TH>
        </tr>
      </THead>
      <TBody>
        {items.map((it) => {
          const r = it.result;
          const fees = r?.services && Number(r.services.price) > 0 ? r.services : null;
          return (
            <TR key={it.id}>
              <TD className="min-w-56">
                <p className="font-medium">{it.partName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge tone="neutral">{enumLabel("serviceType", it.serviceType)}</Badge>
                  {it.materialLabel && (
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2.5 rounded-full border border-border" style={{ background: it.colorHex ?? "transparent" }} aria-hidden />
                      {it.materialLabel}
                    </span>
                  )}
                  {it.printerName && <span>· {it.printerName}</span>}
                  {r?.production && (
                    <span>
                      · {grams(r.production.grams.total)} · {minutesToHuman(Number(r.production.machineHours) * 60)}
                    </span>
                  )}
                  {it.design && (
                    <Link href={`/designs/${it.design.id}`} className="hover:text-primary">
                      · {it.design.number}
                    </Link>
                  )}
                </div>
                {it.description && <p className="mt-1 text-xs text-muted-foreground">{it.description}</p>}
                {it.colorNote && <p className="mt-0.5 text-xs text-muted-foreground">Finish: {it.colorNote}</p>}
                {fees && (
                  <p className="mt-1 text-xs">
                    {fees.modeling && Number(fees.modeling.price) > 0 && <>Modeling {money(fees.modeling.price)} (one-time) </>}
                    {fees.scanning && <>Scanning {money(fees.scanning.price)} (one-time)</>}
                  </p>
                )}
                {r?.production?.priceSource === "MANUAL" && <Badge tone="warning" className="mt-1">manual price</Badge>}
                {it.progress}
              </TD>
              <TD className="tabular text-end">{it.quantity}</TD>
              <TD className="tabular hidden text-end sm:table-cell">{r?.production ? money(r.production.unitPrice) : "—"}</TD>
              <TD className="tabular text-end font-medium">
                {r?.net ? money(r.net) : <span className="text-destructive">incomplete</span>}
                {r?.discount && Number(r.discount) > 0 && <div className="text-xs font-normal text-muted-foreground">−{money(r.discount)} discount</div>}
              </TD>
              <TD className="tabular hidden text-end text-muted-foreground lg:table-cell">{money(r?.cost)}</TD>
              <TD className="tabular hidden text-end text-muted-foreground lg:table-cell">{percent(r?.marginPercent)}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

type Money = { toString(): string };
export interface DocTotals {
  itemsNet: Money;
  orderDiscount: Money;
  minimumAdjustment: Money;
  shippingCharge: Money;
  taxableAmount: Money;
  vatAmount: Money;
  total: Money;
  depositAmount: Money;
  pricingComplete: boolean;
  pricingContext: unknown;
}

export function TotalsBlock({ doc, extra }: { doc: DocTotals; extra?: React.ReactNode }) {
  if (!doc.pricingComplete) return <p className="border-t border-border px-5 py-4 text-sm text-destructive">Totals unavailable until all pricing errors are resolved.</p>;
  const vatRate = (doc.pricingContext as { vatMode: string; vatRate: string }).vatMode === "EXEMPT" ? "0" : (doc.pricingContext as { vatRate: string }).vatRate;
  const rows: [string, string, boolean?][] = [["Items", money(doc.itemsNet)]];
  if (Number(doc.orderDiscount) > 0) rows.push(["Order discount", `−${money(doc.orderDiscount)}`]);
  if (Number(doc.minimumAdjustment) > 0) rows.push(["Minimum order adjustment", money(doc.minimumAdjustment)]);
  if (Number(doc.shippingCharge) > 0) rows.push(["Shipping", money(doc.shippingCharge)]);
  rows.push(["Subtotal (excl. VAT)", money(doc.taxableAmount), true]);
  rows.push([`VAT ${percent(Number(doc.vatAmount) > 0 ? vatRate : "0")}`, money(doc.vatAmount)]);
  return (
    <div className="flex justify-end border-t border-border px-5 py-4">
      <dl className="grid w-full max-w-xs gap-1.5 text-sm">
        {rows.map(([k, v, strong]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`tabular ${strong ? "font-semibold" : ""}`}>{v}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 text-base">
          <dt className="font-semibold">Total</dt>
          <dd className="tabular font-semibold">{money(doc.total)}</dd>
        </div>
        {Number(doc.depositAmount) > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Deposit required</dt>
            <dd className="tabular">{money(doc.depositAmount)}</dd>
          </div>
        )}
        {extra}
      </dl>
    </div>
  );
}

export function InternalSummary({ doc, actual }: { doc: { estimatedCost: Money; estimatedProfit: Money; taxableAmount: Money; pricingComplete: boolean; pricingSummary: unknown }; actual?: { total: string; complete: boolean; profit: string; variance: string } | null }) {
  const s = doc.pricingSummary as { costs?: Record<string, string>; marginPercent?: string | null; markupPercent?: string | null } | null;
  if (!doc.pricingComplete || !s?.costs) return null;
  return (
    <Card>
      <CardHeader title="Profitability" description="Internal only — never printed." />
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Revenue (excl. VAT)</span>
          <span className="tabular">{money(doc.taxableAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Estimated cost</span>
          <span className="tabular">{money(doc.estimatedCost)}</span>
        </div>
        <div className="ms-3 grid gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Items</span>
            <span className="tabular">{money(s.costs.lines)}</span>
          </div>
          {Number(s.costs.shipping) > 0 && (
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className="tabular">{money(s.costs.shipping)}</span>
            </div>
          )}
          {Number(s.costs.packing) > 0 && (
            <div className="flex justify-between">
              <span>Packing</span>
              <span className="tabular">{money(s.costs.packing)}</span>
            </div>
          )}
          {Number(s.costs.transactionFees) > 0 && (
            <div className="flex justify-between">
              <span>Payment fees (est.)</span>
              <span className="tabular">{money(s.costs.transactionFees)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-border pt-2 font-semibold">
          <span>Estimated gross profit</span>
          <span className="tabular">{money(doc.estimatedProfit)}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Margin {percent(s.marginPercent)}</span>
          <span>Markup {percent(s.markupPercent)}</span>
        </div>
        {actual && (
          <div className="mt-2 rounded-lg bg-muted p-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Actual cost{actual.complete ? "" : " (partial)"}</span>
              <span className="tabular">{money(actual.total)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Actual gross profit</span>
              <span className="tabular">{money(actual.profit)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Variance vs estimate</span>
              <span className="tabular">{money(actual.variance)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
