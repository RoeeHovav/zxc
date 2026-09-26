import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, BellRing, Boxes, CalendarClock, CircleDollarSign, ClipboardList, FileText, Info, Layers, Plus, Printer, Sparkles, Users, Wallet, Wrench } from "lucide-react";
import { requireUser, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { computeAlerts, type Alert as AlertItem } from "@/server/services/alerts";
import { financeSummary, monthPeriod } from "@/server/services/finance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { ORDER_STATUS_TONE, PRINTER_STATUS_TONE, enumLabel } from "@/lib/labels";
import { dateTime, money, percent, plural } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const ALERT_ICON: Record<AlertItem["category"], React.ComponentType<{ className?: string }>> = {
  overdue: AlertTriangle,
  deadline: CalendarClock,
  stock: Boxes,
  approval: Sparkles,
  payment: Wallet,
  maintenance: Wrench,
  quote: FileText,
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const welcome = firstParam(sp.welcome) === "1";
  const month = monthPeriod();
  const [alerts, fin, counts, printers, recent, setup] = await Promise.all([
    computeAlerts(),
    can(user, "finance") ? financeSummary(month) : null,
    prisma.order.groupBy({ by: ["status"], where: { status: { notIn: ["COMPLETED", "CANCELED"] } }, _count: true }),
    prisma.printer.findMany({
      where: { status: { not: "RETIRED" } },
      orderBy: { name: "asc" },
      include: { jobs: { where: { status: "PRINTING" }, select: { id: true, number: true, startedAt: true, estimatedMinutes: true, order: { select: { number: true } } } } },
    }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } } } }),
    Promise.all([prisma.material.count(), prisma.printer.count(), prisma.customer.count(), prisma.order.count()]),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const inProduction = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"].reduce((a, s) => a + (byStatus[s] ?? 0), 0);
  const waiting = ["AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL"].reduce((a, s) => a + (byStatus[s] ?? 0), 0);
  const [materialCount, printerCount, customerCount, orderCount] = setup;
  const needsSetup = materialCount === 0 || printerCount === 0 || customerCount === 0;
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(month.from);

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        description={attentionSummary(alerts.filter((a) => a.severity !== "info").length, alerts.length)}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/quotes/new">
                <FileText /> New quote
              </Link>
            </Button>
            <Button asChild>
              <Link href="/orders/new">
                <Plus /> New order
              </Link>
            </Button>
          </>
        }
      />

      {(welcome || needsSetup) && (
        <Card className="mb-6 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-transparent p-5">
            <h2 className="font-semibold">Set up your workshop</h2>
            <p className="mt-1 text-sm text-muted-foreground">Accurate prices need your real costs. These steps take a few minutes.</p>
            <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                { done: false, label: "Review cost rates & VAT", href: "/settings", hint: "Electricity, labor, VAT mode" },
                { done: printerCount > 0, label: "Add your printers", href: "/printers/new", hint: "Purchase price, power, maintenance" },
                { done: materialCount > 0, label: "Add materials", href: "/materials/new", hint: "Price per kg for each filament" },
                { done: customerCount > 0, label: "Add a customer", href: "/customers/new", hint: "Then create your first quote" },
              ].map((s, i) => (
                <li key={i}>
                  <Link href={s.href} className="flex h-full items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40">
                    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-success text-white" : "bg-muted"}`}>
                      {s.done ? "✓" : i + 1}
                    </span>
                    <span>
                      <span className="block font-medium">{s.label}</span>
                      <span className="block text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In production" value={inProduction} hint={`${byStatus.PRINTING ?? 0} printing now`} icon={Layers} href="/production" />
        <Stat label="Waiting" value={waiting} hint="Payment, modeling or approval" icon={ClipboardList} href="/orders?view=waiting" />
        <Stat label="Ready / to deliver" value={byStatus.READY ?? 0} hint="Ready for pickup or shipping" icon={CircleDollarSign} href="/orders?view=ready" />
        {fin ? (
          <Stat label="Unpaid balances" value={money(fin.receivables)} hint="Across all live orders" icon={Wallet} tone={Number(fin.receivables) > 0 ? "warning" : undefined} href="/finance" />
        ) : (
          <Stat label="Open orders" value={orderCount} icon={ClipboardList} />
        )}
      </div>

      {fin && (
        <Card className="mb-6">
          <CardHeader
            title={`${monthName} so far`}
            description="Revenue is recognized on delivery and excludes VAT. Cash counts money actually received."
            actions={
              <Button size="sm" variant="ghost" asChild>
                <Link href="/finance">Finance →</Link>
              </Button>
            }
          />
          <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              ["Revenue (delivered)", money(fin.revenue), `${fin.ordersRecognized} order(s)`],
              ["Cash received", money(fin.cashIn), Number(fin.refunds) > 0 ? `after ${money(fin.refunds)} refunds` : "incl. VAT & deposits"],
              ["Gross profit", money(fin.grossProfit), fin.grossMargin ? `${percent(fin.grossMargin)} margin` : "—"],
              ["Booked (confirmed)", money(fin.booked), `${fin.ordersBooked} new order(s)`],
              ["Expenses", money(fin.expenses), `${money(fin.materialSpend)} materials`],
            ].map(([k, v, h]) => (
              <div key={k}>
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="tabular mt-1 text-lg font-semibold">{v}</p>
                <p className="text-xs text-muted-foreground">{h}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Needs attention" description="Deadlines, stock, approvals, payments and maintenance." />
          {alerts.length === 0 ? (
            <EmptyState icon={BellRing} title="All clear" description="No overdue orders, low stock, pending approvals or unpaid deliveries." />
          ) : (
            <ul className="divide-y divide-border">
              {alerts.slice(0, 25).map((a) => {
                const Icon = ALERT_ICON[a.category] ?? Info;
                return (
                  <li key={a.id}>
                    <Link href={a.href} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40">
                      <span
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${a.severity === "danger" ? "bg-destructive-soft text-destructive" : a.severity === "warning" ? "bg-warning-soft text-warning" : "bg-info-soft text-info"}`}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{a.title}</span>
                        <span className="block text-xs text-muted-foreground">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {alerts.length > 25 && <li className="px-5 py-3 text-xs text-muted-foreground">+{alerts.length - 25} more</li>}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader
              title="Printers"
              actions={
                <Button size="sm" variant="ghost" asChild>
                  <Link href="/production?view=queues">Queues →</Link>
                </Button>
              }
            />
            {printers.length === 0 ? (
              <CardContent>
                <Alert tone="info" icon={Printer} title="No printers yet">
                  <Link href="/printers/new" className="underline">
                    Add your first printer
                  </Link>{" "}
                  to price machine time accurately.
                </Alert>
              </CardContent>
            ) : (
              <ul className="divide-y divide-border">
                {printers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/printers/${p.id}`} className="font-medium hover:text-primary">
                        {p.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{p.jobs[0] ? `${p.jobs[0].number} · order ${p.jobs[0].order.number}` : p.model}</p>
                    </div>
                    <Badge tone={PRINTER_STATUS_TONE[p.status]} dot>
                      {enumLabel("printerStatus", p.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Orders by stage" />
            <CardContent className="grid gap-2">
              {Object.keys(byStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">No open orders.</p>
              ) : (
                Object.entries(byStatus).map(([s, n]) => (
                  <Link key={s} href={`/orders?view=all&q=`} className="flex items-center justify-between text-sm hover:text-primary">
                    <Badge tone={ORDER_STATUS_TONE[s]}>{enumLabel("orderStatus", s)}</Badge>
                    <span className="tabular font-medium">{n}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Recent activity" />
            <ul className="grid gap-3 px-5 py-4 text-sm">
              {recent.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
              {recent.map((r) => (
                <li key={r.id}>
                  <p className="line-clamp-2">{r.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(r.createdAt)} · {r.user?.name ?? "automatic"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <Link href="/customers" className="hidden items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <Users className="size-3.5" /> Customers
          </Link>
        </div>
      </div>
    </>
  );
}

function attentionSummary(urgent: number, total: number) {
  if (total === 0) return "Everything is on track.";
  if (urgent === 0) return `${plural(total, "note")} for your information.`;
  return urgent === total ? `${plural(urgent, "item")} ${urgent === 1 ? "needs" : "need"} attention.` : `${urgent} of ${total} alerts need attention.`;
}
