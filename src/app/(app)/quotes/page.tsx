import Link from "next/link";
import type { Metadata } from "next";
import { FileText, Plus } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listQuotes } from "@/server/services/quotes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterTabs, SearchInput } from "@/components/list-controls";
import { QUOTE_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, money, relativeDays } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const status = firstParam(sp.status) ?? "open";
  const page = Number(firstParam(sp.page) ?? 1) || 1;
  const { rows, total, pageSize } = await listQuotes({ q, status, page });
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Price jobs, send quotes, and turn accepted ones into orders."
        actions={
          <Button asChild>
            <Link href="/quotes/new">
              <Plus /> New quotation
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
              { value: "open", label: "Open" },
              { value: "DRAFT", label: "Drafts" },
              { value: "SENT", label: "Sent" },
              { value: "ACCEPTED", label: "Accepted" },
              { value: "REJECTED", label: "Rejected" },
              { value: "EXPIRED", label: "Expired" },
              { value: "all", label: "All" },
            ]}
          />
          <SearchInput placeholder="Number, customer, part…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={q ? "No matching quotations" : "No quotations here"}
            description={q ? "Try another search." : "Create a quotation to price a job with full cost transparency."}
            action={
              !q ? (
                <Button asChild>
                  <Link href="/quotes/new">
                    <Plus /> New quotation
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Quote</TH>
                  <TH>Customer</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Valid until</TH>
                  <TH className="text-end">Total</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="relative">
                    <TD>
                      <Link href={`/quotes/${r.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                        {r.number}
                        {r.revision > 1 && <span className="text-muted-foreground"> rev {r.revision}</span>}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.title ?? `${r._count.items} item(s)`}</div>
                    </TD>
                    <TD className="max-w-48 truncate">{r.customer.name}</TD>
                    <TD>
                      <Badge tone={QUOTE_STATUS_TONE[r.status]}>{enumLabel("quoteStatus", r.status)}</Badge>
                      {!r.pricingComplete && r.status === "DRAFT" && (
                        <Badge tone="danger" className="ms-1">
                          incomplete
                        </Badge>
                      )}
                      {r.order && <div className="mt-1 text-xs text-muted-foreground">→ {r.order.number}</div>}
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {date(r.validUntil)}
                      {r.status === "SENT" && r.validUntil && <div className="text-xs">{relativeDays(r.validUntil)}</div>}
                    </TD>
                    <TD className="tabular text-end font-medium">{r.pricingComplete ? money(r.total) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} params={{ q, status: status === "open" ? undefined : status }} />
          </>
        )}
      </Card>
    </>
  );
}
