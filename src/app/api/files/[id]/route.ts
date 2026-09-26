import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth";
import { apiHandler, contentDisposition } from "@/server/api";
import { prisma } from "@/server/db";
import { readStoredFile } from "@/server/services/files";
import { isInlineSafe } from "@/domain/files";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    await requireApiUser();
    const { id } = await params;
    const file = await prisma.fileAttachment.findUnique({ where: { id } });
    if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
    let bytes: Buffer;
    try {
      bytes = await readStoredFile(file.storageKey);
    } catch {
      return NextResponse.json({ error: "The stored file is missing. Restore it from backup." }, { status: 410 });
    }
    const forceDownload = new URL(request.url).searchParams.has("download");
    const inline = !forceDownload && isInlineSafe(file.extension);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": inline ? file.mimeType : "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.originalName),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
