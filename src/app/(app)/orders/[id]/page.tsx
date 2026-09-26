import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileDown, Layers, Pencil, Receipt, Repeat, Truck } from "lucide-react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { committedQuantity, computeActualCost, getOrder, orderFacts, orderTimeline } from "@/server/services/orders";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, KeyValue, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FileManager } from "@/components/files/file-manager";
import { DocumentLines, InternalSummary, TotalsBlock } from "@/components/documents/document-view";
import { DESIGN_STATUS_TONE, JOB_STATUS_TONE, ORDER_STATUS_TONE, PAYMENT_STATE_TONE, enumLabel } from "@/lib/labels";
import { date, dateTime, grams, minutesToHuman, money, relativeDays } from "@/lib/format";
import { EDITABLE_ORDER_STATUSES, ORDER_TRANSITIONS, balanceDue, checkOrderTransition, paymentState, type OrderStatus } from "@/domain/status/order";
import { requiresPrint } from "@/domain/pricing/engine";
import { dec } from "@/domain/money";
import type { LineResult } from "@/domain/pricing/types";
import { OrderStatusControls } from "./status-controls";
import { PaymentsPanel } from "./payments-panel";
import { CreateJobsButton } from "./create-jobs-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await prisma.order.findUnique({ where: { id }, select: { number: true } });
  return { title: o?.number ?? "Order" };
}

const STEPS: { label: string; statuses: OrderStatus[] }[] = [
  { label: "Confirmed", statuses: ["AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL"] },
  { label: "Production", statuses: ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"] },
  { label: "Ready", statuses: ["READY"] },
  { label: "Delivered", statuses: ["DELIVERED"] },
  { label: "Completed", statuses: ["COMPLETED"] },
];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  const { id } = await params;
  const o = await getOrder(id);
  if (!o) notFound();
  const [facts, timeline, actual] = await Promise.all([orderFacts(prisma, id), orderTimeline(id), computeActualCost(prisma, id)]);
  const status = o.status as OrderStatus;
  const ps = paymentState({ total: o.total.toString(), amountPaid: o.amountPaid.toString(), status, depositAmount: o.depositAmount.toString() });
  const balance = balanceDue({ total: o.total.toString(), amountPaid: o.amountPaid.toString(), status });
  const transitions = ORDER_TRANSITIONS[status].map((to) => {
    const c = checkOrderTransition(facts, to);
    return { to, ok: c.ok, reasons: c.ok ? [] : c.failures.map((f) => f.message), overridable: c.ok || c.failures.every((f) => f.overridable) };
  });
  const stepIndex = STEPS.findIndex((s) => s.statuses.includes(status));
  const hasPrint = o.items.some((i) => requiresPrint(i.serviceType));
  const openJobs = o.jobs.filter((j) => ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"].includes(j.status)).length;
  const unscheduled = o.items.filter((i) => requiresPrint(i.serviceType)).reduce((a, i) => a + Math.max(0, i.quantity - committedQuantity(i)), 0);
  const overdue = o.dueDate && o.dueDate < new Date() && !["COMPLETED", "CANCELED", "DELIVERED"].includes(status);
  const showActual = o.jobs.some((j) => ["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"].includes(j.status));
  const actualSummary = showActual
    ? {
        total: actual.total,
        complete: actual.complete,
        profit: dec(o.taxableAmount.toString()).minus(dec(actual.total)).toFixed(2),
        variance: dec(actual.total).minus(dec(o.estimatedCost.toString())).toFixed(2),
      }
    : null;

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {o.number}
            <Badge tone={ORDER_STATUS_TONE[status]}>{enumLabel("orderStatus", status)}</Badge>
            {status !== "DRAFT" && <Badge tone={PAYMENT_STATE_TONE[ps]}>{enumLabel("paymentState", ps)}</Badge>}
            {o.priority !== "NORMAL" && <Badge tone={o.priority === "RUSH" || o.priority === "HIGH" ? "danger" : "muted"}>{enumLabel("priority", o.priority)}</Badge>}
          </span>
        }
        description={
          <>
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-foreground hover:text-primary">
              {o.customer.name}
            </Link>
            {o.title && <> · {o.title}</>}
            {o.quote && (
              <>
                {" "}
                · from{" "}
                <Link href={`/quotes/${o.quote.id}`} className="hover:text-primary">
                  {o.quote.number}
                  {o.quote.revision > 1 ? ` rev ${o.quote.revision}` : ""}
                </Link>
              </>
            )}
            {o.revision > 1 && <> · revision {o.revision}</>}
          </>
        }
        actions={
          <>
            {EDITABLE_ORDER_STATUSES.includes(status) && (
              <Button variant="secondary" asChild>
                <Link href={`/orders/${o.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <a href={`/api/pdf/order/${o.id}`} target="_blank" rel="noreferrer">
                <FileDown /> Confirmation
              </a>
            </Button>
            {["READY", "DELIVERED", "COMPLETED"].includes(status) && (
              <Button variant="secondary" asChild>
                <a href={`/api/pdf/delivery/${o.id}`} target="_blank" rel="noreferrer">
                  <Truck /> Delivery note
                </a>
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href={`/orders/new?from=${o.id}`} title="Repeat this order">
                <Repeat /> Repeat
              </Link>
            </Button>
          </>
        }
      />

      {status !== "DRAFT" && status !== "CANCELED" && (
        <ol className="mb-6 grid grid-cols-5 gap-1" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s.label} className="grid gap-1.5">
              <div className={`h-1.5 rounded-full ${i < stepIndex || status === "COMPLETED" ? "bg-success" : i === stepIndex ? "bg-primary" : "bg-muted"}`} />
              <span className={`text-[11px] font-medium ${i === stepIndex ? "text-foreground" : "text-muted-foreground"}`} aria-current={i === stepIndex ? "step" : undefined}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}

      {status === "CANCELED" && (
        <Alert tone="danger" className="mb-6" title={`Canceled ${date(o.canceledAt)}`}>
          {o.cancelReason ?? "No reason recorded."}
          {Number(o.amountPaid) > 0 && <> Refund due: {money(o.amountPaid)}.</>}
        </Alert>
      )}
      {overdue && <Alert tone="danger" className="mb-6" title={`Overdue — was due ${date(o.dueDate)} (${relativeDays(o.dueDate)})`} />}

      <OrderStatusControls id={o.id} status={status} transitions={transitions} pricingComplete={o.pricingComplete} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Items" />
            <DocumentLines
              items={o.items.map((it) => {
                const finishing = it.jobItems.filter((ji) => ["POST_PROCESSING", "QUALITY_CHECK"].includes(ji.job.status)).reduce((a, ji) => a + ji.quantity, 0);
                const reserved = it.reservations.filter((r) => r.status === "ACTIVE").reduce((a, r) => a + Number(r.quantityG) - Number(r.consumedG), 0);
                return {
                  id: it.id,
                  partName: it.partName,
                  description: it.description,
                  serviceType: it.serviceType,
                  quantity: it.quantity,
                  colorNote: it.colorNote,
                  result: it.pricingResult as LineResult | null,
                  materialLabel: (it.pricingInput as { print?: { material?: { label: string } | null } | null }).print?.material?.label ?? null,
                  colorHex: it.material?.colorHex ?? null,
                  printerName: it.printer?.name ?? null,
                  design: it.designProject,
                  progress: (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {requiresPrint(it.serviceType) && (
                        <>
                          <div
                            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={it.quantity}
                            aria-valuenow={it.quantityCompleted}
                            aria-label={`${it.partName} completed units`}
                          >
                            <div className="h-full bg-success" style={{ width: `${Math.min(100, (it.quantityCompleted / it.quantity) * 100)}%` }} />
                          </div>
                          <span className="text-muted-foreground">
                            {it.quantityCompleted}/{it.quantity} done{finishing > 0 ? ` · ${finishing} finishing` : ""}
                          </span>
                          {reserved > 0 && <span className="text-muted-foreground">· {grams(reserved)} reserved</span>}
                        </>
                      )}
                      {it.designProject && <Badge tone={DESIGN_STATUS_TONE[it.designProject.status]}>Design {enumLabel("designStatus", it.designProject.status).toLowerCase()}</Badge>}
                      {it.deadline && <span className="text-muted-foreground">· due {date(it.deadline)}</span>}
                    </div>
                  ),
                };
              })}
            />
            <TotalsBlock doc={o} />
          </Card>

          {hasPrint && status !== "DRAFT" && (
            <Card>
              <CardHeader
                title="Print jobs"
                description={`${openJobs} open · ${o.jobs.filter((j) => j.status === "DONE").length} done · ${o.jobs.filter((j) => j.status === "FAILED").length} failed`}
                actions={
                  <>
                    {unscheduled > 0 && ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"].includes(status) && <CreateJobsButton orderId={o.id} units={unscheduled} />}
                    <Button size="sm" variant="ghost" asChild>
                      <Link href="/production">
                        <Layers /> Production board
                      </Link>
                    </Button>
                  </>
                }
              />
              {o.jobs.length === 0 ? (
                <p className="px-5 py-5 text-sm text-muted-foreground">
                  {["QUEUED"].includes(status) ? "No jobs yet — create jobs to schedule printing." : "Jobs can be created once the order is queued for production."}
                </p>
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Job</TH>
                      <TH>Status</TH>
                      <TH className="hidden sm:table-cell">Printer</TH>
                      <TH className="hidden md:table-cell">Items</TH>
                      <TH className="hidden text-end sm:table-cell">Time (est → actual)</TH>
                      <TH className="hidden text-end md:table-cell">Grams</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {o.jobs.map((j) => (
                      <TR key={j.id}>
                        <TD>
                          <Link href={`/production?job=${j.id}`} className="font-medium whitespace-nowrap hover:text-primary">
                            {j.number}
                          </Link>
                          {j.reprintOfId && <div className="text-xs text-muted-foreground">reprint</div>}
                        </TD>
                        <TD>
                          <Badge tone={JOB_STATUS_TONE[j.status]}>{enumLabel("jobStatus", j.status)}</Badge>
                          {j.failureReason && <div className="mt-1 max-w-48 text-xs text-destructive">{j.failureReason}</div>}
                        </TD>
                        <TD className="hidden sm:table-cell">{j.printer?.name ?? "—"}</TD>
                        <TD className="hidden text-xs md:table-cell">
                          {j.items.map((ji) => (
                            <div key={ji.id}>
                              {ji.quantity}× {ji.orderItem.partName}
                              {ji.quantityGood !== null && ji.quantityGood < ji.quantity && <span className="text-destructive"> ({ji.quantity - ji.quantityGood} rejected)</span>}
                            </div>
                          ))}
                        </TD>
                        <TD className="tabular hidden text-end text-xs whitespace-nowrap sm:table-cell">
                          {minutesToHuman(j.estimatedMinutes)} → {j.actualMinutes ? minutesToHuman(j.actualMinutes) : "…"}
                        </TD>
                        <TD className="tabular hidden text-end text-xs whitespace-nowrap md:table-cell">
                          {grams(j.estimatedGrams)} → {j.actualGrams ? grams(j.actualGrams) : "…"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          )}

          <FileManager target={{ orderId: o.id }} files={o.files} title="Order files" />
        </div>

        <div className="grid content-start gap-6">
          <PaymentsPanel
            orderId={o.id}
            status={status}
            total={o.total.toString()}
            paid={o.amountPaid.toString()}
            balance={balance.toFixed(2)}
            deposit={o.depositAmount.toString()}
            payments={o.payments.map((p) => ({
              id: p.id,
              number: p.number,
              kind: p.kind,
              method: p.method,
              amount: p.amount.toString(),
              receivedAt: p.receivedAt.toISOString(),
              isDeposit: p.isDeposit,
              reference: p.reference,
              voidedAt: p.voidedAt?.toISOString() ?? null,
              voidReason: p.voidReason,
              feeAmount: p.feeAmount.toString(),
            }))}
          />
          <InternalSummary doc={o} actual={actualSummary} />
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Ordered", date(o.orderDate)],
                  ["Due", o.dueDate ? `${date(o.dueDate)} (${relativeDays(o.dueDate)})` : null],
                  ["Delivery", `${enumLabel("deliveryMethod", o.deliveryMethod)}${o.shippingMethod ? ` · ${o.shippingMethod}` : ""}`],
                  ["Address", o.deliveryMethod !== "PICKUP" ? o.deliveryAddress : null],
                  ["Delivery note", o.deliveryNoteNumber],
                  ["Pricing policy", o.pricingPolicy?.name ?? (o.pricingContext as { policy: { name: string } }).policy.name],
                  ["Payment terms", o.paymentTerms],
                  ["Notes to customer", o.customerNotes],
                  ["Internal notes", o.internalNotes],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="grid max-h-96 gap-3 overflow-y-auto px-5 py-4 text-sm">
              {timeline.map((e) => (
                <li key={e.id} className="border-s-2 border-border ps-3">
                  <p>{e.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(e.createdAt)}
                    {e.user ? ` · ${e.user.name}` : " · automatic"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          {o.payments.some((p) => !p.voidedAt && p.kind === "PAYMENT") && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Receipt className="size-3.5" /> Payment acknowledgements are not tax invoices or receipts.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
