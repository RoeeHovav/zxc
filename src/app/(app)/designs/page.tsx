import Link from "next/link";
import type { Metadata } from "next";
import { PenTool, Plus } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listDesigns } from "@/server/services/designs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterTabs, SearchInput } from "@/components/list-controls";
import { DESIGN_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, num } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Modeling & Scanning" };

export default async function DesignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const status = firstParam(sp.status) ?? "open";
  const rows = await listDesigns({ q, status });
  return (
    <>
      <PageHeader
        title="Modeling & Scanning"
        description="Design requests, scans, approvals and your library of reusable designs."
        actions={
          <Button asChild>
            <Link href="/designs/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterTabs
            param="status"
            current={status}
            options={[
              { value: "open", label: "In progress" },
              { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
              { value: "library", label: "Library (approved)" },
              { value: "CANCELED", label: "Canceled" },
              { value: "all", label: "All" },
            ]}
          />
          <SearchInput placeholder="Number, title, customer…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={PenTool} title="No design projects here" description="Modeling and scanning items on confirmed orders create projects automatically, or start one here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Project</TH>
                <TH>Customer</TH>
                <TH>Status</TH>
                <TH className="hidden text-end md:table-cell">Hours (logged / est.)</TH>
                <TH className="hidden text-end sm:table-cell">Re-orders</TH>
                <TH className="hidden lg:table-cell">Due</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.id} className="relative">
                  <TD>
                    <Link href={`/designs/${d.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                      {d.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {d.number} · {enumLabel("designType", d.type)} · {enumLabel("complexity", d.complexity)}
                    </div>
                  </TD>
                  <TD className="max-w-40 truncate">{d.customer.name}</TD>
                  <TD>
                    <Badge tone={DESIGN_STATUS_TONE[d.status]}>{enumLabel("designStatus", d.status)}</Badge>
                  </TD>
                  <TD className="tabular hidden text-end md:table-cell">
                    {num(d.loggedHours)} / {d.estimatedHours ? num(d.estimatedHours) : "—"}
                  </TD>
                  <TD className="tabular hidden text-end sm:table-cell">{Math.max(0, d._count.orderItems - 1)}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{date(d.dueDate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
