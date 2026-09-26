import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { editorInitialFromDoc, editorOptions } from "@/server/services/editor";
import { committedQuantity } from "@/server/services/orders";
import { Alert, PageHeader } from "@/components/ui/misc";
import { DocumentEditor } from "@/components/editor/document-editor";
import { EDITABLE_ORDER_STATUSES, type OrderStatus } from "@/domain/status/order";
import { saveOrderAction } from "../../actions";

export const metadata: Metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" }, include: { jobItems: { include: { job: { select: { status: true } } } } } } } });
  if (!order) notFound();
  if (!EDITABLE_ORDER_STATUSES.includes(order.status as OrderStatus)) redirect(`/orders/${id}`);
  const options = await editorOptions();
  const locked: Record<string, string> = {};
  for (const it of order.items) {
    const c = committedQuantity(it);
    if (c > 0) locked[it.id] = `${c} unit(s) already scheduled or made — quantity can only increase; service and material are fixed.`;
  }
  async function save(payload: string, clientKey: string, intent: "draft" | "confirm") {
    "use server";
    return saveOrderAction(id, payload, clientKey, intent);
  }
  return (
    <>
      <PageHeader title={`Edit ${order.number}`} back={{ href: `/orders/${id}`, label: order.number }} />
      {order.status !== "DRAFT" && (
        <Alert tone="info" className="mb-5" title="Revising a confirmed order">
          Saving creates revision {order.revision + 1}. Reservations are updated automatically and the change is recorded in the order history.
        </Alert>
      )}
      <DocumentEditor mode="order" id={id} options={options} initial={editorInitialFromDoc(order)} save={save} lockedLines={locked} />
    </>
  );
}
