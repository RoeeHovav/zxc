import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { editorInitialBlank, editorOptions } from "@/server/services/editor";
import { Alert, PageHeader } from "@/components/ui/misc";
import { DocumentEditor } from "@/components/editor/document-editor";
import { firstParam } from "@/lib/utils";
import { saveQuoteAction } from "../actions";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const options = await editorOptions();
  const fromId = firstParam(sp.from);
  const from = fromId ? await prisma.quote.findUnique({ where: { id: fromId }, include: { items: { orderBy: { position: "asc" } } } }) : null;
  const initial = editorInitialBlank(options, "quote", firstParam(sp.customerId) ?? null, from);
  async function save(payload: string, clientKey: string) {
    "use server";
    return saveQuoteAction(null, payload, clientKey);
  }
  return (
    <>
      <PageHeader title={from ? `New quotation (copy of ${from.number})` : "New quotation"} back={{ href: "/quotes", label: "Quotations" }} />
      {options.materials.length === 0 && (
        <Alert tone="info" className="mb-5" title="No materials yet">
          Add at least one material with a price per kg in <Link href="/materials/new" className="underline">Materials</Link> to price print jobs.
        </Alert>
      )}
      <DocumentEditor mode="quote" id={null} options={options} initial={initial} save={save} />
    </>
  );
}
