import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, PackagePlus, Pencil } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getMaterial, spoolCostPerKg } from "@/server/services/materials";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, KeyValue, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ORDER_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, dateTime, grams, money, percent, spoolWeight } from "@/lib/format";
import { SpoolActions } from "./spool-actions";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("inventory");
  const { id } = await params;
  const data = await getMaterial(id);
  if (!data) notFound();
  const { material: m, stock } = data;
  const liveSpools = m.spools.filter((s) => s.status === "SEALED" || s.status === "OPEN");
  const pastSpools = m.spools.filter((s) => s.status === "EMPTY" || s.status === "DISCARDED");

  return (
    <>
      <PageHeader
        back={{ href: "/materials", label: "Materials" }}
        title={
          <span className="flex items-center gap-3">
            <span className="size-6 shrink-0 rounded-full border border-border" style={{ background: m.colorHex ?? "transparent" }} aria-hidden />
            {m.brand} {m.productLine} — {m.colorName}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{m.materialType.code}</Badge>
            <span>{m.diameterMm.toString()} mm</span>
            {!m.isActive && <Badge tone="muted">Inactive</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/materials/${m.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/materials/receive?materialId=${m.id}`}>
                <PackagePlus /> Receive spools
              </Link>
            </Button>
          </>
        }
      />
      {!m.pricePerKg && (
        <Alert tone="danger" icon={AlertTriangle} className="mb-6" title="Price per kg is not set">
          Quotes using this material cannot be priced until you set a price (edit the material or receive a purchase).
        </Alert>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Price per kg" value={m.pricePerKg ? money(m.pricePerKg) : "—"} hint={m.wastePercent ? `Waste allowance ${percent(m.wastePercent)}` : "Global waste allowance"} />
        <Stat label="On hand" value={spoolWeight(stock.onHandG, !stock.hasEstimates)} hint={`${stock.spoolCount} spool(s)${stock.hasEstimates ? " · includes estimates" : ""}`} />
        <Stat label="Reserved" value={grams(stock.reservedG)} hint="For confirmed orders" />
        <Stat
          label="Available"
          value={spoolWeight(stock.availableG, !stock.hasEstimates)}
          hint={m.minStockG > 0 ? `Minimum ${grams(m.minStockG)}` : "No minimum set"}
          tone={stock.lowStock ? "danger" : stock.nearThreshold ? "warning" : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Spools" description="Weigh spools periodically to replace estimates with measured weights." />
            {liveSpools.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No spools in stock.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Spool</TH>
                    <TH className="text-end">Remaining</TH>
                    <TH className="hidden text-end md:table-cell">Cost / kg</TH>
                    <TH className="hidden sm:table-cell">Location</TH>
                    <TH className="text-end">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {liveSpools.map((s) => {
                    const pct = Math.max(0, Math.min(100, (Number(s.remainingG) / Number(s.netWeightG)) * 100));
                    return (
                      <TR key={s.id}>
                        <TD>
                          <div className="font-medium">{s.code}</div>
                          <div className="text-xs text-muted-foreground">
                            {enumLabel("spoolStatus", s.status)} · {s.remainingIsMeasured ? `weighed ${date(s.lastWeighedAt)}` : "estimated"}
                          </div>
                        </TD>
                        <TD className="text-end">
                          <div className="tabular">{spoolWeight(s.remainingG, s.remainingIsMeasured)}</div>
                          <div className="ms-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={pct < 15 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
                          </div>
                        </TD>
                        <TD className="tabular hidden text-end md:table-cell">{spoolCostPerKg(s) ? money(Number(spoolCostPerKg(s)).toFixed(2)) : "—"}</TD>
                        <TD className="hidden text-muted-foreground sm:table-cell">{s.storageLocation ?? "—"}</TD>
                        <TD className="text-end">
                          <SpoolActions spoolId={s.id} materialId={m.id} code={s.code} hasEmptyWeight={m.emptySpoolWeightG !== null} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {pastSpools.length > 0 && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{pastSpools.length} empty or discarded spool(s) kept for history.</p>}
          </Card>

          <Card>
            <CardHeader title="Stock ledger" description="Every change to stock, newest first." />
            {m.movements.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No movements yet.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>Type</TH>
                    <TH className="hidden md:table-cell">Spool / reference</TH>
                    <TH className="text-end">Grams</TH>
                  </tr>
                </THead>
                <TBody>
                  {m.movements.map((mv) => (
                    <TR key={mv.id}>
                      <TD className="whitespace-nowrap text-muted-foreground">{dateTime(mv.createdAt)}</TD>
                      <TD>
                        <Badge tone={Number(mv.quantityG) >= 0 ? "success" : mv.type === "CONSUMED" ? "neutral" : "warning"}>{enumLabel("movementType", mv.type)}</Badge>
                        {mv.reason && <div className="mt-1 text-xs text-muted-foreground">{mv.reason}</div>}
                      </TD>
                      <TD className="hidden text-sm md:table-cell">
                        {mv.spool?.code ?? "—"}
                        {mv.printJob && <span className="text-muted-foreground"> · {mv.printJob.number}</span>}
                        {mv.orderItem && (
                          <Link href={`/orders/${mv.orderItem.order.id}`} className="text-muted-foreground hover:text-primary">
                            {" "}
                            · {mv.orderItem.order.number}
                          </Link>
                        )}
                      </TD>
                      <TD className="tabular text-end">
                        {Number(mv.quantityG) > 0 ? "+" : ""}
                        {grams(mv.quantityG)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Reservations" description="Grams held for confirmed orders." />
            <CardContent>
              {m.reservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing reserved.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {m.reservations.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/orders/${r.orderItem.order.id}`} className="font-medium hover:text-primary">
                          {r.orderItem.order.number}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{r.orderItem.partName}</p>
                        <Badge tone={ORDER_STATUS_TONE[r.orderItem.order.status]} className="mt-1">
                          {enumLabel("orderStatus", r.orderItem.order.status)}
                        </Badge>
                      </div>
                      <span className="tabular whitespace-nowrap">{grams(Number(r.quantityG) - Number(r.consumedG))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Supplier", m.supplier?.name],
                  ["SKU", m.sku],
                  ["Density", m.densityGcm3 ? `${m.densityGcm3.toString()} g/cm³` : null],
                  ["Spool net / empty", `${grams(m.defaultSpoolNetG)} / ${m.emptySpoolWeightG !== null ? grams(m.emptySpoolWeightG) : "unknown"}`],
                  ["Storage", m.storageLocation],
                  ["Notes", m.notes],
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
