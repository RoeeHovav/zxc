import Link from "next/link";
import type { Metadata } from "next";
import { Download, Info, Plus, Receipt } from "lucide-react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { financeSummary, monthlySeries } from "@/server/services/finance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PeriodPicker } from "@/components/period-picker";
import { MonthlyBars } from "@/components/charts/monthly-bars";
import { enumLabel } from "@/lib/labels";
import { date, money, percent } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { dec } from "@/domain/money";
import { PERIOD_OPTIONS, resolvePeriod } from "./period";

export const metadata: Metadata = { title: "Finance" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("finance");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const year = period.from.getFullYear();
  const [f, series, receivables, recentPayments] = await Promise.all([
    financeSummary(period),
    monthlySeries(year),
    prisma.order.findMany({
      where: { status: { notIn: ["DRAFT", "CANCELED", "COMPLETED"] } },
      select: { id: true, number: true, total: true, amountPaid: true, status: true, dueDate: true, customer: { select: { id: true, name: true } } },
      orderBy: { orderDate: "asc" },
    }),
    prisma.payment.findMany({ where: { voidedAt: null }, orderBy: { receivedAt: "desc" }, take: 10, include: { order: { select: { id: true, number: true } }, customer: { select: { name: true } } } }),
  ]);
  const owing = receivables
    .map((o) => ({ ...o, due: dec(o.total.toString()).minus(dec(o.amountPaid.toString())) }))
    .filter((o) => o.due.gt(0))
    .sort((a, b) => Number(b.due.minus(a.due)));
  const qs = `period=${period.key}${period.key === "custom" ? `&from=${firstParam(sp.from) ?? ""}&to=${firstParam(sp.to) ?? ""}` : ""}`;

  return (
    <>
      <PageHeader
        title="Finance"
        description={`${period.label} · amounts in ILS`}
        actions={
          <>
            <PeriodPicker options={PERIOD_OPTIONS} current={period.key} from={firstParam(sp.from)} to={firstParam(sp.to)} />
            <Button variant="secondary" asChild>
              <Link href="/finance/expenses">
                <Receipt /> Expenses
              </Link>
            </Button>
            <Button asChild>
              <Link href="/finance/expenses/new">
                <Plus /> Expense
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue (delivered)" value={money(f.revenue)} hint={`${f.ordersRecognized} order(s), excl. VAT`} />
        <Stat label="Cash received" value={money(f.cashIn)} hint={`incl. VAT · refunds ${money(f.refunds)}`} />
        <Stat
          label="Gross profit"
          value={money(f.grossProfit)}
          hint={f.grossMargin ? `${percent(f.grossMargin)} of revenue` : "No delivered orders"}
          tone={Number(f.grossProfit) < 0 ? "danger" : undefined}
        />
        <Stat label="Indicative net profit" value={money(f.netProfit)} hint="Gross profit − operating expenses" tone={Number(f.netProfit) < 0 ? "danger" : undefined} />
        <Stat label="Unpaid balances" value={money(f.receivables)} hint={`${owing.length} order(s) — all periods`} tone={Number(f.receivables) > 0 ? "warning" : undefined} />
        <Stat label="Deposits held" value={money(f.depositsHeld)} hint="Received for undelivered orders" />
        <Stat label="Booked orders" value={money(f.booked)} hint={`${f.ordersBooked} confirmed · est. profit ${money(f.bookedProfit)}`} />
        <Stat label="Material spending" value={money(f.materialSpend)} hint={`of ${money(f.expenses)} total expenses`} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title={`${year} by month`}
          description="Revenue recognized on delivery (excl. VAT) and gross profit after cost of goods."
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/reports?year=${year}`}>Reports →</Link>
            </Button>
          }
        />
        <CardContent>
          <MonthlyBars
            title={`Revenue and gross profit by month, ${year}`}
            labels={MONTHS}
            data={series.map((s) => ({ revenue: s.revenue, grossProfit: s.grossProfit }))}
            series={[
              { key: "revenue", label: "Revenue", color: "var(--series-1)" },
              { key: "grossProfit", label: "Gross profit", color: "var(--series-2)" },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profit breakdown" description={period.label} />
          <CardContent className="grid gap-2 text-sm">
            {[
              ["Revenue recognized (excl. VAT)", f.revenue, false],
              ["− Cost of goods sold", `-${f.cogs}`, false],
              ["= Gross profit", f.grossProfit, true],
              ["− Operating expenses", `-${f.operatingExpenses}`, false],
              ["= Indicative net profit", f.netProfit, true],
            ].map(([k, v, strong]) => (
              <div key={String(k)} className={`flex justify-between ${strong ? "border-t border-border pt-2 font-semibold" : ""}`}>
                <span className={strong ? "" : "text-muted-foreground"}>{k}</span>
                <span className="tabular">{money(String(v).replace(/^-/, "-"))}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">
              COGS uses actual cost for {f.cogsActualShare} of {f.ordersRecognized} order(s), estimates otherwise. VAT collected on these orders: {money(f.vatCollected)}.
            </p>
            <Alert tone="info" icon={Info} className="mt-2">
              Management figures only — not a tax return, VAT report or formal financial statement. Materials enter cost when consumed; equipment through the machine-hour rate. Consult your accountant
              (רואה חשבון) for tax matters.
            </Alert>
          </CardContent>
        </Card>
        <Card>
          <CardHeader
            title="Expenses by category"
            description={period.label}
            actions={
              <Button size="sm" variant="ghost" asChild>
                <a href={`/api/export/expenses?${qs}`}>
                  <Download /> CSV
                </a>
              </Button>
            }
          />
          {f.expenseByCategory.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No expenses in this period.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Category</TH>
                  <TH className="text-end">Amount</TH>
                  <TH className="text-end">of which VAT</TH>
                </tr>
              </THead>
              <TBody>
                {f.expenseByCategory
                  .sort((a, b) => Number(b.amount) - Number(a.amount))
                  .map((e) => (
                    <TR key={e.category}>
                      <TD>
                        <Link href={`/finance/expenses?category=${e.category}&${qs}`} className="hover:text-primary">
                          {enumLabel("expenseCategory", e.category)}
                        </Link>
                      </TD>
                      <TD className="tabular text-end">{money(e.amount)}</TD>
                      <TD className="tabular text-end text-muted-foreground">{money(e.vat)}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Who owes money"
            description="Live orders with an unpaid balance"
            actions={
              <Button size="sm" variant="ghost" asChild>
                <a href="/api/export/receivables">
                  <Download /> CSV
                </a>
              </Button>
            }
          />
          {owing.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Order</TH>
                  <TH>Customer</TH>
                  <TH className="text-end">Due</TH>
                </tr>
              </THead>
              <TBody>
                {owing.slice(0, 15).map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">
                        {o.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">{enumLabel("orderStatus", o.status)}</div>
                    </TD>
                    <TD>
                      <Link href={`/customers/${o.customer.id}`} className="hover:text-primary">
                        {o.customer.name}
                      </Link>
                    </TD>
                    <TD className="tabular text-end font-medium text-warning">{money(o.due.toFixed(2))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Cash by payment method"
            description={period.label}
            actions={
              <Button size="sm" variant="ghost" asChild>
                <a href={`/api/export/payments?${qs}`}>
                  <Download /> CSV
                </a>
              </Button>
            }
          />
          <CardContent className="grid gap-2 text-sm">
            {f.byMethod.length === 0 ? (
              <p className="text-muted-foreground">No payments in this period.</p>
            ) : (
              f.byMethod.map((m) => (
                <div key={m.method} className="flex justify-between">
                  <span>{enumLabel("paymentMethod", m.method)}</span>
                  <span className="tabular">{money(m.amount)}</span>
                </div>
              ))
            )}
            {Number(f.paymentFees) > 0 && <p className="text-xs text-muted-foreground">Processing fees paid: {money(f.paymentFees)}</p>}
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest payments</p>
              <ul className="grid gap-1.5">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3">
                    <Link href={`/orders/${p.order.id}`} className="min-w-0 truncate hover:text-primary">
                      {date(p.receivedAt)} · {p.customer.name} · {p.order.number}
                    </Link>
                    <span className={`tabular ${p.kind === "REFUND" ? "text-destructive" : ""}`}>
                      {p.kind === "REFUND" ? "−" : ""}
                      {money(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
