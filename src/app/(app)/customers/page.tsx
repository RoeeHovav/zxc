import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listCustomers, type CustomerFilter } from "@/server/services/customers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterTabs, SearchInput } from "@/components/list-controls";
import { enumLabel } from "@/lib/labels";
import { money } from "@/lib/format";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("customers");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const filter = (firstParam(sp.filter) ?? "active") as CustomerFilter;
  const page = Number(firstParam(sp.page) ?? 1) || 1;
  const { rows, total, pageSize } = await listCustomers({ q, filter, page });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you quote, print for, and get paid by."
        actions={
          <Button asChild>
            <Link href="/customers/new">
              <Plus /> New customer
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs
            current={filter}
            options={[
              { value: "active", label: "Active" },
              { value: "balance", label: "Owes money" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All" },
            ]}
          />
          <SearchInput placeholder="Name, phone, email, tag…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "No matching customers" : filter === "active" ? "No customers yet" : "Nothing here"}
            description={q ? "Try a different name, phone number or email." : "Add your first customer to start quoting and taking orders."}
            action={
              !q && filter === "active" ? (
                <Button asChild>
                  <Link href="/customers/new">
                    <Plus /> New customer
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
                  <TH>Customer</TH>
                  <TH className="hidden md:table-cell">Contact</TH>
                  <TH className="hidden lg:table-cell">City</TH>
                  <TH className="text-end">Orders</TH>
                  <TH className="text-end">Balance</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} className="relative">
                    <TD>
                      <Link href={`/customers/${c.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{c.number}</span>
                        {c.company && <span>· {c.company}</span>}
                        {c.archivedAt && <Badge tone="muted">Archived</Badge>}
                        {c.tags.slice(0, 3).map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <div className="text-sm">{c.phone ?? c.email ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Prefers {enumLabel("contactMethod", c.preferredContact).toLowerCase()}</div>
                    </TD>
                    <TD className="hidden text-muted-foreground lg:table-cell">{c.city ?? "—"}</TD>
                    <TD className="tabular text-end">{c._count.orders}</TD>
                    <TD className="tabular text-end">
                      {Number(c.balance) > 0 ? (
                        <span className="font-medium text-warning">{money(c.balance)}</span>
                      ) : Number(c.balance) < 0 ? (
                        <span className="text-info">{money(c.balance)} credit</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} params={{ q, filter: filter === "active" ? undefined : filter }} />
          </>
        )}
      </Card>
    </>
  );
}
