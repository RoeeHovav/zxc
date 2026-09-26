import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getPrinter } from "@/server/services/printers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, KeyValue, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { JOB_STATUS_TONE, PRINTER_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, grams, minutesToHuman, money, num, percent } from "@/lib/format";
import { MaintenanceControls, TaskDoneButton } from "./maintenance";

export const metadata: Metadata = { title: "Printer" };

export default async function PrinterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("production");
  const { id } = await params;
  const data = await getPrinter(id);
  if (!data) notFound();
  const { printer: p, hours, rate, tasks, stats } = data;
  const rows: [string, string][] = [
    ["Depreciation", rate.perHour.depreciation],
    ["Energy", rate.perHour.energy],
    ["Maintenance reserve", rate.perHour.maintenance],
    ["Consumables", rate.perHour.consumables],
  ];
  return (
    <>
      <PageHeader
        back={{ href: "/printers", label: "Printers" }}
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.manufacturer} {p.model}
            <Badge tone={PRINTER_STATUS_TONE[p.status]} dot>
              {enumLabel("printerStatus", p.status)}
            </Badge>
          </span>
        }
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/printers/${p.id}/edit`}>
              <Pencil /> Edit
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Machine cost"
          value={`${money(Number(rate.total).toFixed(2))}/h`}
          hint={rate.source === "OVERRIDE" ? "Fixed override" : rate.source === "DEFAULT" ? "Default rate (no data)" : "Calculated"}
        />
        <Stat label="Print hours" value={num(hours, 0)} />
        <Stat label="Jobs completed" value={stats.done} />
        <Stat
          label="Failure rate"
          value={stats.failureRate ? percent(stats.failureRate) : "—"}
          hint={`${stats.failed} failed`}
          tone={stats.failureRate && Number(stats.failureRate) > 0.1 ? "warning" : undefined}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader
              title="Maintenance schedule"
              description="Due items appear on the dashboard."
              actions={<MaintenanceControls printerId={p.id} tasks={tasks.map((t) => ({ id: t.id, title: t.title }))} />}
            />
            {tasks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No scheduled maintenance. Add tasks like “Clean & lubricate rods — every 200 h” or “Replace nozzle — every 90 days”.</p>
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Every {[t.intervalPrintHours ? `${t.intervalPrintHours} h` : null, t.intervalDays ? `${t.intervalDays} days` : null].filter(Boolean).join(" or ")} · last {date(t.lastDoneAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={t.status.overdue ? "danger" : t.status.due ? "warning" : "success"}>{t.status.reason || "OK"}</Badge>
                      <TaskDoneButton printerId={p.id} taskId={t.id} title={t.title} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent jobs" />
            {p.jobs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Job</TH>
                    <TH>Status</TH>
                    <TH className="hidden text-end sm:table-cell">Time</TH>
                    <TH className="hidden text-end sm:table-cell">Grams</TH>
                  </tr>
                </THead>
                <TBody>
                  {p.jobs.map((j) => (
                    <TR key={j.id}>
                      <TD>
                        <Link href={`/production?job=${j.id}`} className="font-medium hover:text-primary">
                          {j.number}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          <Link href={`/orders/${j.order.id}`} className="hover:text-primary">
                            {j.order.number}
                          </Link>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={JOB_STATUS_TONE[j.status]}>{enumLabel("jobStatus", j.status)}</Badge>
                      </TD>
                      <TD className="tabular hidden text-end sm:table-cell">{minutesToHuman(j.actualMinutes ?? j.estimatedMinutes)}</TD>
                      <TD className="tabular hidden text-end sm:table-cell">{grams(j.actualGrams ?? j.estimatedGrams)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Maintenance log" />
            {p.maintenanceLogs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {p.maintenanceLogs.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">{l.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {date(l.performedAt)}
                        {l.printHoursAt && ` · at ${num(l.printHoursAt, 0)} h`}
                        {l.task && ` · ${l.task.title}`}
                      </p>
                    </div>
                    {l.cost && <span className="tabular">{money(l.cost)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Cost per hour" />
            <CardContent className="grid gap-3 text-sm">
              {rate.source === "OVERRIDE" ? (
                <p>Fixed override of {money(Number(rate.total).toFixed(2))}/h is used for pricing.</p>
              ) : (
                <>
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="tabular">{Number(v).toFixed(4)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-2 font-semibold">
                    <span>Total</span>
                    <span className="tabular">{Number(rate.total).toFixed(4)} ₪/h</span>
                  </div>
                </>
              )}
              {rate.missing.length > 0 && rate.source !== "OVERRIDE" && (
                <Alert tone="warning" title="Incomplete cost data">
                  Missing {rate.missing.join(", ")}. {rate.source === "DEFAULT" ? "Quotes use the default machine rate." : "These components are excluded and flagged on quotes."}
                </Alert>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Specifications" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Nozzle", `${p.nozzleDiameterMm.toString()} mm${p.nozzleNotes ? ` · ${p.nozzleNotes}` : ""}`],
                  ["Multi-material", p.hasMultiMaterial ? "Yes" : "No"],
                  ["Build volume", p.buildVolume],
                  ["Supported materials", p.supportedMaterialTypes.map((t) => t.code).join(", ") || null],
                  ["Serial number", p.serialNumber],
                  ["Purchased", p.purchasedAt ? `${date(p.purchasedAt)}${p.purchasePrice ? ` · ${money(p.purchasePrice)}` : ""}` : p.purchasePrice ? money(p.purchasePrice) : null],
                  ["Location", p.location],
                  ["Notes", p.notes],
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
