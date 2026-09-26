import Link from "next/link";
import type { Metadata } from "next";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseBackup, Download, FileArchive, ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { storageUsedBytes } from "@/server/services/files";
import { getSettings } from "@/server/services/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, KeyValue } from "@/components/ui/misc";
import { formatBytes } from "@/domain/files";
import { dateTime } from "@/lib/format";
import { IntegrityCheck } from "./integrity-check";

export const metadata: Metadata = { title: "Data & backups" };

async function latestBackup() {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return null;
  try {
    const files = (await readdir(/*turbopackIgnore: true*/ dir)).filter((f) => f.endsWith(".dump") || f.endsWith(".tar.gz"));
    let best: { name: string; at: Date; size: number } | null = null;
    for (const f of files) {
      const s = await stat(/*turbopackIgnore: true*/ path.join(dir, f));
      if (!best || s.mtime > best.at) best = { name: f, at: s.mtime, size: s.size };
    }
    return best ? { ...best, stale: Date.now() - best.at.getTime() > 2 * 86400000 } : null;
  } catch {
    return null;
  }
}

export default async function DataPage() {
  await requireUser("settings");
  const [used, settings, backup, auditLog, counts] = await Promise.all([
    storageUsedBytes(),
    getSettings(),
    latestBackup(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { user: { select: { name: true } } } }),
    Promise.all([prisma.customer.count(), prisma.order.count(), prisma.quote.count(), prisma.payment.count(), prisma.fileAttachment.count()]),
  ]);
  const stale = backup ? backup.stale : true;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Export your data" description="Your data is yours: take it anywhere." />
        <CardContent className="grid gap-3">
          <Button asChild className="w-fit">
            <a href="/api/export/full">
              <FileArchive /> Download full export (ZIP)
            </a>
          </Button>
          <Button variant="secondary" asChild className="w-fit">
            <Link href="/reports?view=exports">
              <Download /> Individual CSV exports
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Per-customer personal data exports and erasure are on each customer page. Accounting records are retained after erasure (Israeli bookkeeping rules generally require 7 years — confirm with your accountant).
          </p>
          <KeyValue
            items={[
              ["Customers", counts[0]],
              ["Orders", counts[1]],
              ["Quotations", counts[2]],
              ["Payments", counts[3]],
              ["Files", `${counts[4]} · ${formatBytes(used)} of ${settings.storageQuotaMb} MB`],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Backups" description="Automatic database + file backups run outside the app (see docs/BACKUP.md)." />
        <CardContent className="grid gap-3">
          {backup ? (
            <Alert tone={stale ? "warning" : "success"} icon={DatabaseBackup} title={stale ? "Latest backup is more than 2 days old" : "Backups are current"}>
              {backup.name} · {formatBytes(backup.size)} · {dateTime(backup.at)}
            </Alert>
          ) : (
            <Alert tone="warning" icon={DatabaseBackup} title="No backup status available">
              Set <code>BACKUP_DIR</code> for the app to show the latest backup, and make sure the backup service (Docker Compose <code>backup</code> service or cron running <code>scripts/backup.sh</code>) is enabled.
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">Restore with <code className="rounded bg-muted px-1">scripts/restore.sh</code> — tested by <code className="rounded bg-muted px-1">npm run test:backup</code> against a throwaway database.</p>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Data integrity check" description="Cross-checks cached values (amount paid, spool weights, completed units, production status, stored files) against their source records." />
        <CardContent>
          <IntegrityCheck />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Audit log" description="Latest 60 changes. Full log is included in the ZIP export." />
        <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
          {auditLog.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="me-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{a.entityType}</span>
                {a.summary}
              </span>
              <span className="text-xs text-muted-foreground">
                {dateTime(a.createdAt)} · {a.user?.name ?? "system"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {settings.isDemo && (
        <Alert tone="warning" icon={ShieldCheck} title="Demo database" className="lg:col-span-2">
          This database is flagged as demo data. Use a separate database (DATABASE_URL) for real business records.
        </Alert>
      )}
    </div>
  );
}
