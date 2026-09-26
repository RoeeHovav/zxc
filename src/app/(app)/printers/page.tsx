import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, Plus, Printer as PrinterIcon, Wrench } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listPrinters } from "@/server/services/printers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { PRINTER_STATUS_TONE, enumLabel } from "@/lib/labels";
import { money, minutesToHuman, num } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Printers" };

export default async function PrintersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("production");
  const sp = await searchParams;
  const showRetired = firstParam(sp.retired) === "1";
  const printers = await listPrinters(showRetired);
  return (
    <>
      <PageHeader
        title="Printers"
        description="Your fleet, operating costs and maintenance."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href={showRetired ? "/printers" : "/printers?retired=1"}>{showRetired ? "Hide retired" : "Show retired"}</Link>
            </Button>
            <Button asChild>
              <Link href="/printers/new">
                <Plus /> Add printer
              </Link>
            </Button>
          </>
        }
      />
      {printers.length === 0 ? (
        <Card>
          <EmptyState
            icon={PrinterIcon}
            title="No printers yet"
            description="Add your printers with their purchase price, power draw and maintenance costs so machine time is priced accurately."
            action={
              <Button asChild>
                <Link href="/printers/new">
                  <Plus /> Add printer
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {printers.map((p) => {
            const printing = p.jobs.find((j) => j.status === "PRINTING");
            const queued = p.jobs.filter((j) => j.status === "QUEUED");
            return (
              <Link key={p.id} href={`/printers/${p.id}`} className="group block rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold group-hover:text-primary">{p.name}</h2>
                    <p className="truncate text-sm text-muted-foreground">
                      {p.manufacturer} {p.model} · {p.nozzleDiameterMm.toString()} mm{p.hasMultiMaterial ? " · AMS" : ""}
                    </p>
                  </div>
                  <Badge tone={PRINTER_STATUS_TONE[p.status]} dot>
                    {enumLabel("printerStatus", p.status)}
                  </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Machine rate</dt>
                    <dd className="tabular font-medium">{money(Number(p.rate).toFixed(2))}/h</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Print hours</dt>
                    <dd className="tabular font-medium">{num(p.hours, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Queue</dt>
                    <dd className="tabular font-medium">{queued.length}</dd>
                  </div>
                </dl>
                <div className="mt-4 space-y-1.5 text-xs">
                  {printing && (
                    <p className="text-primary">
                      Printing {printing.number} · order {printing.order.number}
                      {printing.estimatedMinutes && ` · ${minutesToHuman(printing.estimatedMinutes)} est.`}
                    </p>
                  )}
                  {p.maintenanceDue > 0 && (
                    <p className={p.maintenanceOverdue ? "flex items-center gap-1.5 text-destructive" : "flex items-center gap-1.5 text-warning"}>
                      <Wrench className="size-3.5" /> {p.maintenanceDue} maintenance task(s) {p.maintenanceOverdue ? "overdue" : "due"}
                    </p>
                  )}
                  {p.rateSource === "DEFAULT" && (
                    <p className="flex items-center gap-1.5 text-warning">
                      <AlertTriangle className="size-3.5" /> No cost data — quotes use the default rate
                    </p>
                  )}
                  {p.rateSource === "COMPONENTS" && p.rateMissing.length > 0 && (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <AlertTriangle className="size-3.5" /> Missing: {p.rateMissing.map((m) => m.split(" (")[0]).join(", ")}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
