import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { editorInitialBlank, editorOptions } from "@/server/services/editor";
import { Alert, PageHeader } from "@/components/ui/misc";
import { DocumentEditor } from "@/components/editor/document-editor";
import { firstParam } from "@/lib/utils";
import { saveOrderAction } from "../actions";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const options = await editorOptions();
  const fromId = firstParam(sp.from);
  const from = fromId ? await prisma.order.findUnique({ where: { id: fromId }, include: { items: { orderBy: { position: "asc" } } } }) : null;
  const initial = editorInitialBlank(options, "order", firstParam(sp.customerId) ?? from?.customerId ?? null, from);
  async function save(payload: string, clientKey: string, intent: "draft" | "confirm") {
    "use server";
    return saveOrderAction(null, payload, clientKey, intent);
  }
  return (
    <>
      <PageHeader title={from ? `Repeat order ${from.number}` : "New order"} description={from ? "Items are copied and priced at today's rates. Design fees for existing designs are not charged again." : undefined} back={{ href: "/orders", label: "Orders" }} />
      {options.materials.length === 0 && (
        <Alert tone="info" className="mb-5" title="No materials yet">
          Add at least one material with a price per kg in <Link href="/materials/new" className="underline">Materials</Link> to price print jobs.
        </Alert>
      )}
      <DocumentEditor mode="order" id={null} options={options} initial={initial} save={save} />
    </>
  );
}
