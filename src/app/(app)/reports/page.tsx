import Link from "next/link";
import type { Metadata } from "next";
import { Download, FileArchive } from "lucide-react";
import { requireUser } from "@/server/auth";
import { monthlySeries } from "@/server/services/finance";
import { dailySeries, profitability } from "@/server/services/reports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PeriodPicker } from "@/components/period-picker";
import { FilterTabs } from "@/components/list-controls";
import { MonthlyBars } from "@/components/charts/monthly-bars";
import { date, grams, money, num, percent } from "@/lib/format";
import { enumLabel } from "@/lib/labels";
import { firstParam } from "@/lib/utils";
import { dec, ZERO } from "@/domain/money";
import { PERIOD_OPTIONS, resolvePeriod } from "../finance/period";

export const metadata: Metadata = { title: "Reports" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Row = { label: string; orders: number; units: number; grams: string; machineHours: string; revenue: string; cost: string; profit: string; margin: string | null };

function GroupTable({ rows, showProduction, services }: { rows: Row[]; showProduction?: boolean; services?: boolean }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-muted-foreground">No delivered orders in this period.</p>;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Name</TH>
          <TH className="text-end">Orders</TH>
          {showProduction && <TH className="hidden text-end md:table-cell">Units</TH>}
          {showProduction && <TH className="hidden text-end lg:table-cell">Filament</TH>}
          {showProduction && <TH className="hidden text-end lg:table-cell">Machine h</TH>}
          <TH className="text-end">Revenue</TH>
          <TH className="hidden text-end sm:table-cell">Cost</TH>
          <TH className="text-end">Profit</TH>
          <TH className="text-end">Margin</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.label}>
            <TD className="font-medium">{services ? enumLabel("serviceType", r.label) : r.label}</TD>
            <TD className="tabular text-end">{r.orders}</TD>
            {showProduction && <TD className="tabular hidden text-end md:table-cell">{r.units}</TD>}
            {showProduction && <TD className="tabular hidden text-end lg:table-cell">{grams(r.grams)}</TD>}
            {showProduction && <TD className="tabular hidden text-end lg:table-cell">{num(r.machineHours, 1)}</TD>}
            <TD className="tabular text-end">{money(r.revenue)}</TD>
            <TD className="tabular hidden text-end text-muted-foreground sm:table-cell">{money(r.cost)}</TD>
            <TD className={`tabular text-end font-medium ${Number(r.profit) < 0 ? "text-destructive" : ""}`}>{money(r.profit)}</TD>
            <TD className="tabular text-end">{percent(r.margin)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("finance");
  const sp = await searchParams;
  const view = firstParam(sp.view) ?? "summary";
  const period = resolvePeriod({ ...sp, period: firstParam(sp.period) ?? "year" });
  const year = Number(firstParam(sp.year)) || period.from.getFullYear();
  const qs = `period=${period.key}${period.key === "custom" ? `&from=${firstParam(sp.from) ?? ""}&to=${firstParam(sp.to) ?? ""}` : ""}`;
  const [months, prof, daily] = await Promise.all([monthlySeries(year), view === "summary" ? null : profitability(period), view === "daily" ? dailySeries(period) : null]);
  const yearTotals = months.reduce((a, m) => ({ revenue: a.revenue.plus(dec(m.revenue)), cogs: a.cogs.plus(dec(m.cogs)), cash: a.cash.plus(dec(m.cash)), expenses: a.expenses.plus(dec(m.expenses)) }), { revenue: ZERO, cogs: ZERO, cash: ZERO, expenses: ZERO });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Management reporting. Not a tax or statutory accounting report."
        actions={
          <>
            {view !== "summary" && <PeriodPicker options={PERIOD_OPTIONS} current={period.key} from={firstParam(sp.from)} to={firstParam(sp.to)} />}
            <Button variant="secondary" asChild>
              <a href="/api/export/full">
                <FileArchive /> Full export (ZIP)
              </a>
            </Button>
          </>
        }
      />
      <div className="mb-5">
        <FilterTabs
          param="view"
          current={view}
          options={[
            { value: "summary", label: "Monthly & yearly" },
            { value: "daily", label: "Daily" },
            { value: "orders", label: "By order & variance" },
            { value: "customers", label: "By customer" },
            { value: "materials", label: "By material" },
            { value: "printers", label: "By printer" },
            { value: "services", label: "By service" },
            { value: "exports", label: "CSV exports" },
          ]}
        />
      </div>

      {view === "summary" && (
        <div className="grid gap-6">
          <Card>
            <CardHeader
              title={`${year}`}
              description="Revenue recognized on delivery (excl. VAT) · gross profit after cost of goods"
              actions={
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/reports?year=${year - 1}`}>← {year - 1}</Link>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/reports?year=${year + 1}`}>{year + 1} →</Link>
                  </Button>
                </div>
              }
            />
            <CardContent>
              <MonthlyBars
                title={`Revenue and gross profit by month, ${year}`}
                labels={MONTHS}
                data={months.map((m) => ({ revenue: m.revenue, grossProfit: m.grossProfit }))}
                series={[
                  { key: "revenue", label: "Revenue", color: "var(--series-1)" },
                  { key: "grossProfit", label: "Gross profit", color: "var(--series-2)" },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Monthly table" actions={<Button size="sm" variant="ghost" asChild><a href={`/api/export/daily?period=custom&from=${year}-01-01&to=${year}-12-31`}><Download /> Daily CSV for {year}</a></Button>} />
            <Table>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH className="text-end">Revenue</TH>
                  <TH className="hidden text-end sm:table-cell">Cost of goods</TH>
                  <TH className="text-end">Gross profit</TH>
                  <TH className="hidden text-end md:table-cell">Cash received</TH>
                  <TH className="hidden text-end md:table-cell">Expenses</TH>
                </tr>
              </THead>
              <TBody>
                {months.map((m) => (
                  <TR key={m.month}>
                    <TD>{MONTHS[m.month]}</TD>
                    <TD className="tabular text-end">{money(m.revenue)}</TD>
                    <TD className="tabular hidden text-end text-muted-foreground sm:table-cell">{money(m.cogs)}</TD>
                    <TD className="tabular text-end font-medium">{money(m.grossProfit)}</TD>
                    <TD className="tabular hidden text-end md:table-cell">{money(m.cash)}</TD>
                    <TD className="tabular hidden text-end md:table-cell">{money(m.expenses)}</TD>
                  </TR>
                ))}
                <TR className="bg-muted/50 font-semibold">
                  <TD>Year</TD>
                  <TD className="tabular text-end">{money(yearTotals.revenue.toFixed(2))}</TD>
                  <TD className="tabular hidden text-end sm:table-cell">{money(yearTotals.cogs.toFixed(2))}</TD>
                  <TD className="tabular text-end">{money(yearTotals.revenue.minus(yearTotals.cogs).toFixed(2))}</TD>
                  <TD className="tabular hidden text-end md:table-cell">{money(yearTotals.cash.toFixed(2))}</TD>
                  <TD className="tabular hidden text-end md:table-cell">{money(yearTotals.expenses.toFixed(2))}</TD>
                </TR>
              </TBody>
            </Table>
          </Card>
        </div>
      )}

      {view === "daily" && daily && (
        <Card>
          <CardHeader title={`Daily — ${period.label}`} actions={<Button size="sm" variant="ghost" asChild><a href={`/api/export/daily?${qs}`}><Download /> CSV</a></Button>} />
          {daily.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No deliveries or payments in this period.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Day</TH>
                  <TH className="text-end">Delivered</TH>
                  <TH className="text-end">Revenue</TH>
                  <TH className="text-end">Gross profit</TH>
                  <TH className="text-end">Cash</TH>
                </tr>
              </THead>
              <TBody>
                {daily.map((d) => (
                  <TR key={d.day}>
                    <TD>{date(d.day)}</TD>
                    <TD className="tabular text-end">{d.orders}</TD>
                    <TD className="tabular text-end">{money(d.revenue)}</TD>
                    <TD className="tabular text-end">{money(d.grossProfit)}</TD>
                    <TD className="tabular text-end">{money(d.cash)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {view === "orders" && prof && (
        <Card>
          <CardHeader title={`Orders delivered — ${period.label}`} description="Pricing variance = actual cost − estimated cost (positive means it cost more than quoted)." actions={<Button size="sm" variant="ghost" asChild><a href={`/api/export/profitability-orders?${qs}`}><Download /> CSV</a></Button>} />
          {prof.byOrder.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No delivered orders in this period.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Order</TH>
                  <TH className="hidden md:table-cell">Customer</TH>
                  <TH className="text-end">Revenue</TH>
                  <TH className="hidden text-end sm:table-cell">Est. cost</TH>
                  <TH className="hidden text-end sm:table-cell">Actual cost</TH>
                  <TH className="text-end">Variance</TH>
                  <TH className="text-end">Margin</TH>
                </tr>
              </THead>
              <TBody>
                {prof.byOrder.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">
                        {o.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">{date(o.deliveredAt)}</div>
                    </TD>
                    <TD className="hidden md:table-cell">{o.customer}</TD>
                    <TD className="tabular text-end">{money(o.revenue)}</TD>
                    <TD className="tabular hidden text-end text-muted-foreground sm:table-cell">{money(o.estimatedCost)}</TD>
                    <TD className="tabular hidden text-end sm:table-cell">{o.actualCost ? money(o.actualCost) : <Badge tone="muted">not completed</Badge>}</TD>
                    <TD className={`tabular text-end ${o.variance && Number(o.variance) > 0 ? "text-destructive" : o.variance ? "text-success" : ""}`}>{o.variance ? money(o.variance) : "—"}</TD>
                    <TD className="tabular text-end">{percent(o.margin)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {prof && ["customers", "materials", "printers", "services"].includes(view) && (
        <Card>
          <CardHeader
            title={`Profitability by ${view.slice(0, -1)} — ${period.label}`}
            description={view === "customers" ? "Order revenue (excl. VAT) and actual cost where known." : "Line revenue with order-level adjustments allocated pro rata; estimated line cost."}
            actions={
              view !== "services" && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/api/export/profitability-${view}?${qs}`}>
                    <Download /> CSV
                  </a>
                </Button>
              )
            }
          />
          <GroupTable rows={view === "customers" ? prof.byCustomer : view === "materials" ? prof.byMaterial : view === "printers" ? prof.byPrinter : prof.byService} showProduction={view !== "customers"} services={view === "services"} />
        </Card>
      )}

      {view === "exports" && (
        <Card>
          <CardHeader title="CSV exports" description="UTF-8 with BOM (Excel-friendly, Hebrew safe). Formula-like cells are neutralized." />
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["customers", "Customers"],
              ["quotes", "Quotations"],
              ["orders", "Orders"],
              ["order-items", "Order items"],
              ["payments", "Payments & refunds"],
              ["expenses", "Expenses"],
              ["receivables", "Unpaid balances"],
              ["materials", "Materials"],
              ["spools", "Spools"],
              ["stock-movements", "Stock movements"],
              ["jobs", "Print jobs"],
              ["designs", "Design projects"],
            ].map(([k, label]) => (
              <a key={k} href={`/api/export/${k}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm hover:border-primary/40">
                {label}
                <Download className="size-4 text-muted-foreground" />
              </a>
            ))}
          </CardContent>
          <CardContent>
            <Alert tone="info" title="Full export">
              The ZIP export contains every table as CSV plus settings and the audit log in JSON. For restoring the application use the database backups (see docs/BACKUP.md).
            </Alert>
          </CardContent>
        </Card>
      )}
    </>
  );
}
