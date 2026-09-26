import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { editorInitialFromDoc, editorOptions } from "@/server/services/editor";
import { PageHeader } from "@/components/ui/misc";
import { DocumentEditor } from "@/components/editor/document-editor";
import { saveQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "Edit quotation" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  const { id } = await params;
  const quote = await prisma.quote.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!quote) notFound();
  if (quote.status !== "DRAFT") redirect(`/quotes/${id}`);
  const options = await editorOptions();
  async function save(payload: string, clientKey: string) {
    "use server";
    return saveQuoteAction(id, payload, clientKey);
  }
  return (
    <>
      <PageHeader title={`Edit ${quote.number}${quote.revision > 1 ? ` rev ${quote.revision}` : ""}`} back={{ href: `/quotes/${id}`, label: quote.number }} />
      <DocumentEditor mode="quote" id={id} options={options} initial={editorInitialFromDoc(quote)} save={save} />
    </>
  );
}
