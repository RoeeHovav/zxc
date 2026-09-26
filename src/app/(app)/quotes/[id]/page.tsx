import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, FileDown, History } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getQuote, expireQuotes } from "@/server/services/quotes";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, KeyValue, PageHeader } from "@/components/ui/misc";
import { FileManager } from "@/components/files/file-manager";
import { DocumentLines, InternalSummary, TotalsBlock } from "@/components/documents/document-view";
import { QUOTE_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, dateTime } from "@/lib/format";
import type { LineResult } from "@/domain/pricing/types";
import { QuoteActions } from "./quote-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const q = await prisma.quote.findUnique({ where: { id }, select: { number: true } });
  return { title: q?.number ?? "Quotation" };
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  await expireQuotes();
  const { id } = await params;
  const q = await getQuote(id);
  if (!q) notFound();
  const summary = q.pricingSummary as { issues?: { severity: string; message: string }[]; costs?: { total: string } } | null;
  const errors = summary?.issues?.filter((i) => i.severity === "error") ?? [];
  const timeline = await prisma.auditLog.findMany({ where: { entityType: "QUOTE", entityId: id }, orderBy: { createdAt: "desc" }, take: 20 });

  return (
    <>
      <PageHeader
        back={{ href: "/quotes", label: "Quotations" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {q.number}
            {q.revision > 1 && <span className="text-muted-foreground">rev {q.revision}</span>}
            <Badge tone={QUOTE_STATUS_TONE[q.status]}>{enumLabel("quoteStatus", q.status)}</Badge>
          </span>
        }
        description={
          <>
            <Link href={`/customers/${q.customer.id}`} className="font-medium text-foreground hover:text-primary">
              {q.customer.name}
            </Link>
            {q.title && <> · {q.title}</>}
          </>
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <a href={`/api/pdf/quote/${q.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <QuoteActions id={q.id} status={q.status} pricingComplete={q.pricingComplete} hasOrder={!!q.order} number={q.number} />
          </>
        }
      />

      {q.order && (
        <Alert tone="success" className="mb-6" title={`Converted to order ${q.order.number}`}>
          <Link href={`/orders/${q.order.id}`} className="inline-flex items-center gap-1 font-medium underline">
            Open order <ArrowRight className="size-3.5" />
          </Link>
        </Alert>
      )}
      {q.next && (
        <Alert tone="info" icon={History} className="mb-6" title={`Superseded by revision ${q.next.revision}`}>
          <Link href={`/quotes/${q.next.id}`} className="font-medium underline">
            Open the latest revision
          </Link>
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert tone="danger" icon={AlertTriangle} className="mb-6" title="This draft cannot be sent yet">
          <ul className="list-disc ps-4">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Items" description="What the customer sees, plus internal cost columns (never printed)." />
            <DocumentLines
              items={q.items.map((it) => ({
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
              }))}
            />
            <TotalsBlock doc={q} />
          </Card>
          {(q.customerNotes || q.paymentTerms) && (
            <Card>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                {q.paymentTerms && (
                  <div>
                    <p className="text-xs text-muted-foreground">Payment terms</p>
                    <p className="mt-1 whitespace-pre-wrap">{q.paymentTerms}</p>
                  </div>
                )}
                {q.customerNotes && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notes to customer</p>
                    <p className="mt-1 whitespace-pre-wrap">{q.customerNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <FileManager target={{ quoteId: q.id }} files={q.files} title="Quote files" />
        </div>
        <div className="grid content-start gap-6">
          <InternalSummary doc={q} />
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Issued", date(q.issueDate)],
                  ["Valid until", date(q.validUntil)],
                  ["Needed by", q.requestedBy ? date(q.requestedBy) : null],
                  ["Pricing policy", q.pricingPolicy?.name ?? (q.pricingContext as { policy: { name: string } }).policy.name],
                  ["Rates captured", dateTime((q.pricingContext as { capturedAt: string }).capturedAt)],
                  ["Sent", q.sentAt ? dateTime(q.sentAt) : null],
                  [
                    "Customer decision",
                    q.acceptedAt
                      ? `Accepted ${date(q.acceptedAt)}${q.approvalNote ? ` — ${q.approvalNote}` : ""}`
                      : q.rejectedAt
                        ? `Rejected ${date(q.rejectedAt)}${q.rejectionReason ? ` — ${q.rejectionReason}` : ""}`
                        : null,
                  ],
                  [
                    "Previous revision",
                    q.previous ? (
                      <Link key="p" href={`/quotes/${q.previous.id}`} className="hover:text-primary">
                        rev {q.previous.revision}
                      </Link>
                    ) : null,
                  ],
                ]}
              />
              {q.internalNotes && (
                <div className="mt-4 text-sm">
                  <p className="text-xs text-muted-foreground">Internal notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{q.internalNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="grid gap-3 px-5 py-4 text-sm">
              {timeline.map((e) => (
                <li key={e.id}>
                  <p>{e.summary}</p>
                  <p className="text-xs text-muted-foreground">{dateTime(e.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
