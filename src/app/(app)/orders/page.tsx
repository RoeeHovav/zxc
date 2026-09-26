import Link from "next/link";
import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listOrders } from "@/server/services/orders";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterTabs, SearchInput } from "@/components/list-controls";
import { ORDER_STATUS_TONE, PAYMENT_STATE_TONE, enumLabel } from "@/lib/labels";
import { date, money, relativeDays } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { paymentState } from "@/domain/status/order";
import { requiresPrint } from "@/domain/pricing/engine";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const view = firstParam(sp.view) ?? "active";
  const page = Number(firstParam(sp.page) ?? 1) || 1;
  const { rows, total, pageSize } = await listOrders({ q, view, page });
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Orders"
        description="Everything in progress, from confirmation to delivery and payment."
        actions={
          <Button asChild>
            <Link href="/orders/new">
              <Plus /> New order
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterTabs
            param="view"
            current={view}
            options={[
              { value: "active", label: "Active" },
              { value: "waiting", label: "Waiting" },
              { value: "production", label: "In production" },
              { value: "ready", label: "Ready / delivered" },
              { value: "overdue", label: "Overdue" },
              { value: "draft", label: "Drafts" },
              { value: "done", label: "Closed" },
              { value: "all", label: "All" },
            ]}
          />
          <SearchInput placeholder="Order #, customer, part…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={q ? "No matching orders" : "No orders here"}
            description={q ? "Try another search." : "Create an order directly, or accept a quotation to create one."}
            action={
              !q ? (
                <Button asChild>
                  <Link href="/orders/new">
                    <Plus /> New order
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
                  <TH>Order</TH>
                  <TH>Customer</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Progress</TH>
                  <TH className="hidden sm:table-cell">Due</TH>
                  <TH className="text-end">Total</TH>
                  <TH className="hidden text-end lg:table-cell">Payment</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((o) => {
                  const printItems = o.items.filter((i) => requiresPrint(i.serviceType));
                  const units = printItems.reduce((a, i) => a + i.quantity, 0);
                  const done = printItems.reduce((a, i) => a + Math.min(i.quantity, i.quantityCompleted), 0);
                  const ps = paymentState({ total: o.total.toString(), amountPaid: o.amountPaid.toString(), status: o.status, depositAmount: o.depositAmount.toString() });
                  const overdue = o.dueDate && o.dueDate < now && !["COMPLETED", "CANCELED", "DELIVERED"].includes(o.status);
                  return (
                    <TR key={o.id} className="relative">
                      <TD>
                        <Link href={`/orders/${o.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                          {o.number}
                        </Link>
                        <div className="max-w-56 truncate text-xs text-muted-foreground">{o.title ?? o.items.map((i) => i.partName).join(", ")}</div>
                      </TD>
                      <TD className="max-w-40 truncate">{o.customer.name}</TD>
                      <TD>
                        <Badge tone={ORDER_STATUS_TONE[o.status]}>{enumLabel("orderStatus", o.status)}</Badge>
                        {o.priority === "RUSH" && <Badge tone="danger" className="ms-1">Rush</Badge>}
                      </TD>
                      <TD className="hidden md:table-cell">
                        {units > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-success" style={{ width: `${(done / units) * 100}%` }} />
                            </div>
                            <span className="tabular text-xs text-muted-foreground">
                              {done}/{units}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">services</span>
                        )}
                      </TD>
                      <TD className={`hidden sm:table-cell ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                        {date(o.dueDate)}
                        {o.dueDate && !["COMPLETED", "CANCELED"].includes(o.status) && <div className="text-xs">{relativeDays(o.dueDate)}</div>}
                      </TD>
                      <TD className="tabular text-end font-medium">{money(o.total)}</TD>
                      <TD className="hidden text-end lg:table-cell">
                        <Badge tone={PAYMENT_STATE_TONE[ps]}>{enumLabel("paymentState", ps)}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} params={{ q, view: view === "active" ? undefined : view }} />
          </>
        )}
      </Card>
    </>
  );
}
