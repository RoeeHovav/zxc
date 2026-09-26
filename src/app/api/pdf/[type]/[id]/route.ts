import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth";
import { apiHandler, contentDisposition } from "@/server/api";
import { deliveryNoteDocument, orderConfirmationDocument, paymentAckDocument, quoteDocument } from "@/server/services/customer-documents";
import { renderCustomerPdf } from "@/server/pdf/document";

export const runtime = "nodejs";

const BUILDERS = {
  quote: quoteDocument,
  order: orderConfirmationDocument,
  delivery: deliveryNoteDocument,
  receipt: paymentAckDocument,
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  return apiHandler(async () => {
    await requireApiUser("sales");
    const { type, id } = await params;
    const build = BUILDERS[type as keyof typeof BUILDERS];
    if (!build) return NextResponse.json({ error: "Unknown document type." }, { status: 404 });
    const doc = await build(id);
    const pdf = await renderCustomerPdf(doc);
    const name = `${doc.title} ${doc.number}.pdf`.replace(/[^\w .()-]+/g, "_");
    const download = new URL(request.url).searchParams.has("download");
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(download ? "attachment" : "inline", name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
