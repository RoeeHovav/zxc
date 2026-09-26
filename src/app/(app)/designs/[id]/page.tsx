import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pencil, Repeat } from "lucide-react";
import { requireUser } from "@/server/auth";
import { designFeeEstimate, getDesign } from "@/server/services/designs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge, KeyValue, PageHeader, Stat } from "@/components/ui/misc";
import { FileManager } from "@/components/files/file-manager";
import { DESIGN_STATUS_TONE, ORDER_STATUS_TONE, enumLabel } from "@/lib/labels";
import { date, minutesToHuman, money, num } from "@/lib/format";
import { DesignControls, RevisionControls, TimeLog } from "./design-controls";

export const metadata: Metadata = { title: "Design project" };

const PURPOSES = [
  { key: "REFERENCE", title: "Reference images & brief" },
  { key: "SCAN", title: "Scan files" },
  { key: "CAD", title: "CAD / working files" },
  { key: "DELIVERABLE", title: "Final deliverables" },
];

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  const { id } = await params;
  const data = await getDesign(id);
  if (!data) notFound();
  const { design: d, hours } = data;
  const fee = designFeeEstimate(d);
  const revisionsUsed = d.revisions.length;
  const unbilled = d.revisions.filter((r) => r.isChargeable && !r.billedAt);
  const reusable = d.status === "APPROVED" || d.status === "DELIVERED";

  return (
    <>
      <PageHeader
        back={{ href: "/designs", label: "Modeling & Scanning" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.title}
            <Badge tone={DESIGN_STATUS_TONE[d.status]}>{enumLabel("designStatus", d.status)}</Badge>
          </span>
        }
        description={
          <>
            {d.number} · {enumLabel("designType", d.type)} ·{" "}
            <Link href={`/customers/${d.customer.id}`} className="font-medium text-foreground hover:text-primary">
              {d.customer.name}
            </Link>
          </>
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/designs/${d.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            {reusable && (
              <Button asChild>
                <Link href={`/orders/new?customerId=${d.customer.id}&design=${d.id}`}>
                  <Repeat /> Order prints
                </Link>
              </Button>
            )}
          </>
        }
      />
      <DesignControls id={d.id} status={d.status} />
      <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Logged hours" value={num(hours.total)} hint={d.estimatedHours ? `of ${num(d.estimatedHours)} estimated` : "No estimate"} tone={hours.variance && Number(hours.variance) > 0 ? "warning" : undefined} />
        <Stat label="Design fee" value={fee ? money(fee) : "—"} hint={d.feeMode === "FIXED" ? "Fixed" : `${money(d.hourlyRate)}/h × estimate`} />
        <Stat label="Revisions" value={`${revisionsUsed} / ${d.includedRevisions}`} hint={unbilled.length ? `${unbilled.length} chargeable unbilled` : "included"} tone={revisionsUsed > d.includedRevisions ? "warning" : undefined} />
        <Stat label="Orders" value={d.orderItems.length} hint={d.orderItems.length > 1 ? `${d.orderItems.length - 1} re-order(s)` : "—"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <TimeLog
            id={d.id}
            entries={d.timeEntries.map((t) => ({ id: t.id, category: t.category, hours: t.hours.toString(), date: t.date.toISOString(), billable: t.billable, notes: t.notes }))}
            byCategory={hours.byCategory}
          />
          <RevisionControls
            id={d.id}
            status={d.status}
            included={d.includedRevisions}
            fee={d.additionalRevisionFee?.toString() ?? null}
            revisions={d.revisions.map((r) => ({ id: r.id, number: r.number, description: r.description, isChargeable: r.isChargeable, charge: r.charge?.toString() ?? null, billedAt: r.billedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null, requestedAt: r.requestedAt.toISOString() }))}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {PURPOSES.map((p) => (
              <FileManager key={p.key} target={{ designProjectId: d.id }} purpose={p.key} title={p.title} files={d.files.filter((f) => (f.purpose ?? "REFERENCE") === p.key)} />
            ))}
          </div>
        </div>
        <div className="grid content-start gap-6">
          {d.status === "AWAITING_APPROVAL" && (
            <Alert tone="warning" title="Waiting for the customer">
              Share previews/renders with the customer and record their approval or requested changes here. PrintForge never messages customers automatically.
            </Alert>
          )}
          <Card>
            <CardHeader title="Brief" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Complexity", enumLabel("complexity", d.complexity)],
                  ["Due", d.dueDate ? date(d.dueDate) : null],
                  ["Description", d.description],
                  ["Ownership", enumLabel("ownership", d.ownership)],
                  ["License notes", d.licenseNotes],
                  ["Approved", d.approvedAt ? `${date(d.approvedAt)}${d.approvalNote ? ` — ${d.approvalNote}` : ""}` : null],
                  ["Delivered", d.deliveredAt ? date(d.deliveredAt) : null],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Print defaults for re-orders" />
            <CardContent>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ["Material", d.defaultMaterial ? `${d.defaultMaterial.materialType.code} ${d.defaultMaterial.brand} ${d.defaultMaterial.colorName}` : null],
                  ["Printer", d.defaultPrinter?.name],
                  ["Grams / unit", d.defaultGramsPerUnit ? `${num(d.defaultGramsPerUnit)} g` : null],
                  ["Print time / unit", d.defaultPrintMinutes ? minutesToHuman(d.defaultPrintMinutes) : null],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Orders using this design" />
            {d.orderItems.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Not ordered yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.orderItems.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/orders/${i.order.id}`} className="font-medium hover:text-primary">
                      {i.order.number}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {i.quantity}× · {date(i.order.orderDate)}
                      </span>
                    </Link>
                    <Badge tone={ORDER_STATUS_TONE[i.order.status]}>{enumLabel("orderStatus", i.order.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
