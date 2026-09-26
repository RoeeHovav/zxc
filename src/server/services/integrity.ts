import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { ZERO, dec } from "@/domain/money";
import { syncProductionStatus } from "@/domain/status/order";
import { orderFacts } from "./orders";
import { storedFileExists, uploadRoot } from "./files";

/** Cross-checks cached values against their ledgers. Read-only; reports discrepancies. */
export async function integrityReport() {
  const spools = await prisma.spool.findMany({ select: { id: true, code: true, remainingG: true, movements: { select: { quantityG: true } } } });
  const spoolMismatches = spools
    .map((s) => ({ code: s.code, cached: s.remainingG.toString(), ledger: s.movements.reduce((a, m) => a.plus(dec(m.quantityG.toString())), ZERO).toFixed(2) }))
    .filter((x) => !dec(x.cached).eq(dec(x.ledger)));

  const items = await prisma.orderItem.findMany({ select: { partName: true, quantityCompleted: true, order: { select: { number: true } }, jobItems: { select: { quantity: true, quantityGood: true, job: { select: { status: true } } } } } });
  const itemMismatches = items
    .map((i) => ({ order: i.order.number, part: i.partName, cached: i.quantityCompleted, jobs: i.jobItems.filter((j) => j.job.status === "DONE").reduce((a, j) => a + (j.quantityGood ?? j.quantity), 0) }))
    .filter((x) => x.cached !== x.jobs);

  const production = await prisma.order.findMany({ where: { status: { in: ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"] } }, select: { id: true, number: true, status: true } });
  const statusMismatches: { number: string; status: string; expected: string }[] = [];
  for (const o of production) {
    const target = syncProductionStatus(await orderFacts(prisma, o.id));
    if (target) statusMismatches.push({ number: o.number, status: o.status, expected: target });
  }

  const files = await prisma.fileAttachment.findMany({ select: { id: true, originalName: true, storageKey: true } });
  const missingFiles: string[] = [];
  for (const f of files) if (!(await storedFileExists(f.storageKey))) missingFiles.push(f.originalName);
  const known = new Set(files.map((f) => f.storageKey));
  const orphanFiles: string[] = [];
  try {
    for (const y of await readdir(uploadRoot())) {
      for (const m of await readdir(path.join(uploadRoot(), y)).catch(() => [])) {
        for (const f of await readdir(path.join(uploadRoot(), y, m)).catch(() => [])) {
          const key = `${y}/${m}/${f}`;
          if (!known.has(key)) orphanFiles.push(key);
        }
      }
    }
  } catch {
    // upload dir does not exist yet
  }
  return { spoolMismatches, itemMismatches, statusMismatches, missingFiles, orphanFiles };
}
