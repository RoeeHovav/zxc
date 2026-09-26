import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth";
import { apiHandler, contentDisposition } from "@/server/api";
import { EXPORT_KINDS, exportCsv, fullExportZip, type ExportKind } from "@/server/services/exports";
import { resolvePeriod } from "@/app/(app)/finance/period";
import { prisma } from "@/server/db";
import { audit } from "@/server/services/common";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  return apiHandler(async () => {
    const user = await requireApiUser("export");
    const { kind } = await params;
    const url = new URL(request.url);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "full") {
      const zip = await fullExportZip();
      await prisma.$transaction((tx) => audit(tx, { userId: user.id, entityType: "EXPORT", entityId: "full", action: "EXPORT", summary: "Downloaded full data export" }));
      return new Response(new Uint8Array(zip), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition("attachment", `printforge-export-${stamp}.zip`), "Cache-Control": "no-store" },
      });
    }
    if (!EXPORT_KINDS.includes(kind as ExportKind)) return NextResponse.json({ error: "Unknown export." }, { status: 404 });
    const sp = Object.fromEntries(url.searchParams.entries());
    const period = sp.period || sp.from ? resolvePeriod(sp) : undefined;
    const csv = await exportCsv(kind as ExportKind, period);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition("attachment", `${kind}${period ? `-${period.from.toISOString().slice(0, 10)}` : ""}-${stamp}.csv`),
        "Cache-Control": "no-store",
      },
    });
  });
}
