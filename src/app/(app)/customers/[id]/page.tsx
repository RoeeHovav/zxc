import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClipboardList, FileText, Mail, MapPin, Phone, Plus, ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getCustomerDetail } from "@/server/services/customers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, KeyValue, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FileManager } from "@/components/files/file-manager";
import { ORDER_STATUS_TONE, QUOTE_STATUS_TONE, DESIGN_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, money } from "@/lib/format";
import { CustomerActions } from "./customer-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await getCustomerDetail(id);
  return { title: d?.customer.name ?? "Customer" };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("customers");
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  const { customer: c, balance, totalPaid, lifetimeValue } = detail;
  const address = [c.addressLine1, c.addressLine2, [c.postalCode, c.city].filter(Boolean).join(" "), c.country].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{c.number}</span>
            {c.company && <span>· {c.company}</span>}
            {c.archivedAt && <Badge tone="muted">Archived</Badge>}
            {c.anonymizedAt && <Badge tone="warning">Anonymized</Badge>}
            {c.vatExempt && <Badge tone="info">VAT exempt</Badge>}
            {c.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </span>
        }
        actions={
          <>
            {!c.archivedAt && (
              <>
                <Button variant="secondary" asChild>
                  <Link href={`/quotes/new?customerId=${c.id}`}>
                    <FileText /> New quote
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/orders/new?customerId=${c.id}`}>
                    <Plus /> New order
                  </Link>
                </Button>
              </>
            )}
            <CustomerActions id={c.id} archived={!!c.archivedAt} anonymized={!!c.anonymizedAt} number={c.number} />
          </>
        }
      />

      {c.anonymizedAt && (
        <Alert tone="warning" icon={ShieldCheck} className="mb-6" title="Personal data erased">
          This customer was anonymized on {date(c.anonymizedAt)}. Orders and payments are kept for accounting retention.
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance due" value={Number(balance) < 0 ? `${money(balance)}` : money(balance)} hint={Number(balance) < 0 ? "Customer has credit" : Number(balance) > 0 ? "Outstanding" : "Settled"} tone={Number(balance) > 0 ? "warning" : undefined} />
        <Stat label="Paid to date" value={money(totalPaid)} />
        <Stat label="Lifetime orders" value={money(lifetimeValue)} hint={`${c.orders.length} order(s)`} />
        <Stat label="Quotations" value={c.quotes.length} hint={`${c.quotes.filter((q) => q.status === "ACCEPTED").length} accepted`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Orders" actions={!c.archivedAt && <Button size="sm" variant="secondary" asChild><Link href={`/orders/new?customerId=${c.id}`}><Plus /> Order</Link></Button>} />
            {c.orders.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No orders yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Order</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">Date</TH>
                    <TH className="text-end">Total</TH>
                    <TH className="text-end">Due</TH>
                  </tr>
                </THead>
                <TBody>
                  {c.orders.map((o) => {
                    const due = o.status === "CANCELED" ? -Number(o.amountPaid) : Number(o.total) - Number(o.amountPaid);
                    return (
                      <TR key={o.id} className="relative">
                        <TD>
                          <Link href={`/orders/${o.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                            {o.number}
                          </Link>
                          {o.title && <div className="text-xs text-muted-foreground">{o.title}</div>}
                        </TD>
                        <TD>
                          <Badge tone={ORDER_STATUS_TONE[o.status]}>{enumLabel("orderStatus", o.status)}</Badge>
                        </TD>
                        <TD className="hidden text-muted-foreground sm:table-cell">{date(o.orderDate)}</TD>
                        <TD className="tabular text-end">{money(o.total)}</TD>
                        <TD className="tabular text-end">{due !== 0 ? money(due.toFixed(2)) : "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Quotations" />
            {c.quotes.length === 0 ? (
              <EmptyState icon={FileText} title="No quotations yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Quote</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">Valid until</TH>
                    <TH className="text-end">Total</TH>
                  </tr>
                </THead>
                <TBody>
                  {c.quotes.map((q) => (
                    <TR key={q.id} className="relative">
                      <TD>
                        <Link href={`/quotes/${q.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                          {q.number}
                          {q.revision > 1 && <span className="text-muted-foreground"> rev {q.revision}</span>}
                        </Link>
                        {q.title && <div className="text-xs text-muted-foreground">{q.title}</div>}
                      </TD>
                      <TD>
                        <Badge tone={QUOTE_STATUS_TONE[q.status]}>{enumLabel("quoteStatus", q.status)}</Badge>
                      </TD>
                      <TD className="hidden text-muted-foreground sm:table-cell">{date(q.validUntil)}</TD>
                      <TD className="tabular text-end">{money(q.total)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Payments" />
            {c.payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Receipt</TH>
                    <TH>Order</TH>
                    <TH className="hidden sm:table-cell">Method</TH>
                    <TH className="hidden sm:table-cell">Date</TH>
                    <TH className="text-end">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {c.payments.map((p) => (
                    <TR key={p.id} className={p.voidedAt ? "opacity-50" : undefined}>
                      <TD>
                        {p.number}
                        {p.kind === "REFUND" && <Badge tone="warning" className="ms-2">Refund</Badge>}
                        {p.voidedAt && <Badge tone="muted" className="ms-2">Void</Badge>}
                      </TD>
                      <TD>
                        <Link href={`/orders/${p.order.id}`} className="hover:text-primary">
                          {p.order.number}
                        </Link>
                      </TD>
                      <TD className="hidden sm:table-cell">{enumLabel("paymentMethod", p.method)}</TD>
                      <TD className="hidden text-muted-foreground sm:table-cell">{date(p.receivedAt)}</TD>
                      <TD className="tabular text-end">{p.kind === "REFUND" ? `−${money(p.amount)}` : money(p.amount)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {c.designs.length > 0 && (
            <Card>
              <CardHeader title="Designs & scans" description="Reusable designs can be re-ordered without paying the design fee again." />
              <ul className="divide-y divide-border">
                {c.designs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/designs/${d.id}`} className="min-w-0 font-medium hover:text-primary">
                      <span className="text-muted-foreground">{d.number}</span> {d.title}
                    </Link>
                    <Badge tone={DESIGN_STATUS_TONE[d.status]}>{enumLabel("designStatus", d.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Contact details" actions={!c.anonymizedAt && <Button size="sm" variant="ghost" asChild><Link href={`/customers/${c.id}/edit`}>Edit</Link></Button>} />
            <CardContent className="grid gap-4 text-sm">
              <div className="grid gap-2.5">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-2 hover:text-primary">
                    <Phone className="size-4 text-muted-foreground" /> {c.phone}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-2 break-all hover:text-primary">
                    <Mail className="size-4 shrink-0 text-muted-foreground" /> {c.email}
                  </a>
                )}
                {address && (
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {address}
                  </p>
                )}
              </div>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Preferred contact", enumLabel("contactMethod", c.preferredContact)],
                  ["Tax ID", c.taxId],
                  ["Pricing policy", c.pricingPolicy?.name ?? "Default"],
                  ["Marketing consent", c.marketingConsent ? "Yes" : "No"],
                  ["Customer since", date(c.createdAt)],
                ]}
              />
              {c.notes && (
                <div>
                  <p className="text-xs text-muted-foreground">Internal notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{c.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <FileManager target={{ customerId: c.id }} files={c.files} title="Customer files" disabled={!!c.anonymizedAt} />
        </div>
      </div>
    </>
  );
}
