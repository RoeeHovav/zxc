import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { ServiceError, audit } from "./common";
import { getSettings } from "./settings";
import { detectFileType } from "@/domain/files";

/**
 * Runtime data directory. The `turbopackIgnore` hints keep `next build` from tracing the whole
 * project (including local .env files and uploads) into the standalone output.
 */
export function uploadRoot() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./storage/uploads");
}

const KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

function keyPath(key: string) {
  if (!KEY_RE.test(key)) throw new ServiceError("Invalid storage key.");
  return path.join(/*turbopackIgnore: true*/ uploadRoot(), key);
}

export type AttachTarget = {
  customerId?: string | null;
  quoteId?: string | null;
  quoteItemId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
  designProjectId?: string | null;
  printJobId?: string | null;
  expenseId?: string | null;
};

export async function storageUsedBytes() {
  const agg = await prisma.fileAttachment.aggregate({ _sum: { sizeBytes: true } });
  return agg._sum.sizeBytes ?? 0;
}

/** Validates and stores an uploaded file, then records it. Never executes or transforms content. */
export async function saveUpload(userId: string, file: { name: string; bytes: Buffer }, target: AttachTarget, purpose?: string | null) {
  const settings = await getSettings();
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  if (file.bytes.length === 0) throw new ServiceError("The file is empty.");
  if (file.bytes.length > maxBytes) throw new ServiceError(`File is larger than the ${settings.maxUploadMb} MB limit.`);
  const used = await storageUsedBytes();
  if (used + file.bytes.length > settings.storageQuotaMb * 1024 * 1024)
    throw new ServiceError(`Storage quota of ${settings.storageQuotaMb} MB would be exceeded. Delete old files or raise the quota in Settings.`);

  const detected = detectFileType(file.name, file.bytes.subarray(0, 4096), file.bytes.length);
  if (!detected.ok) throw new ServiceError(detected.error);

  const targets = Object.entries(target).filter(([, v]) => v);
  if (targets.length === 0 && purpose !== "LOGO") throw new ServiceError("A file must be attached to a record.");
  if (purpose === "LOGO" && !["png", "jpg", "jpeg"].includes(detected.extension)) throw new ServiceError("The logo must be a PNG or JPEG image.");

  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const full = keyPath(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, file.bytes, { mode: 0o600 });
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const safeName = sanitizeFileName(file.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const rec = await tx.fileAttachment.create({
        data: {
          originalName: safeName,
          storageKey: key,
          mimeType: detected.mime,
          extension: detected.extension,
          sizeBytes: file.bytes.length,
          sha256,
          kind: detected.kind,
          purpose: purpose ?? null,
          uploadedById: userId,
          ...Object.fromEntries(targets),
        },
      });
      await audit(tx, { userId, entityType: "FILE", entityId: rec.id, action: "UPLOAD", summary: `Uploaded ${safeName}`, details: { ...Object.fromEntries(targets) } });
      return rec;
    });
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ full, { force: true });
    throw e;
  }
}

export function sanitizeFileName(name: string) {
  const base = path.basename(name.replace(/\\/g, "/"));
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").trim();
  return (cleaned || "file").slice(0, 180);
}

export async function readStoredFile(key: string) {
  return readFile(/*turbopackIgnore: true*/ keyPath(key));
}

export async function storedFileExists(key: string) {
  try {
    await stat(/*turbopackIgnore: true*/ keyPath(key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteStoredFile(key: string) {
  try {
    await rm(/*turbopackIgnore: true*/ keyPath(key), { force: true });
  } catch {
    // best effort; orphan cleanup is reported by the storage check
  }
}

export async function deleteAttachment(userId: string, id: string) {
  const f = await prisma.fileAttachment.findUnique({ where: { id } });
  if (!f) return;
  await prisma.$transaction(async (tx) => {
    await tx.settings.updateMany({ where: { logoFileId: id }, data: { logoFileId: null } });
    await tx.fileAttachment.delete({ where: { id } });
    await audit(tx, { userId, entityType: "FILE", entityId: id, action: "DELETE", summary: `Deleted ${f.originalName}` });
  });
  await deleteStoredFile(f.storageKey);
}
