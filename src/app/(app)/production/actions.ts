"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { runAction } from "@/server/action";
import { optDate, optDecimal, optId, optText } from "@/domain/schemas/common";
import { ServiceError } from "@/server/services/common";
import { advanceJob, assignJob, cancelJob, finishPrint, reorderJob, reprintJob, startJob, undoStart } from "@/server/services/production";

const refresh = () => {
  revalidatePath("/production");
  revalidatePath("/orders", "layout");
  revalidatePath("/materials", "layout");
  revalidatePath("/printers", "layout");
  revalidatePath("/dashboard");
};

export async function startJobAction(jobId: string, printerId: string | null) {
  const user = await requireUser("production");
  return runAction(async () => {
    await startJob(user.id, jobId, printerId);
    refresh();
  }, "Print started.");
}

export async function undoStartAction(jobId: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    await undoStart(user.id, jobId);
    refresh();
  }, "Moved back to queue.");
}

const finishSchema = z.object({
  outcome: z.enum(["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"]),
  actualMinutes: optDecimal({ min: 0, max: 100000, label: "Actual time" }),
  consumption: z
    .array(z.object({ spoolId: optId(), materialId: optId(), grams: optDecimal({ min: 0, max: 100000, label: "Grams" }) }))
    .max(16)
    .default([]),
  good: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
  failureReason: optText(300),
  notes: optText(1000),
});

export async function finishPrintAction(jobId: string, payload: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      throw new ServiceError("Malformed data.");
    }
    const f = finishSchema.parse(raw);
    await finishPrint(user.id, jobId, {
      ...f,
      consumption: f.consumption.filter((c) => c.grams !== null).map((c) => ({ spoolId: c.spoolId, materialId: c.materialId, grams: c.grams! })),
    });
    refresh();
  }, "Print recorded.");
}

const advanceSchema = z.object({
  to: z.enum(["QUALITY_CHECK", "POST_PROCESSING", "DONE", "FAILED"]),
  good: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
  qcNotes: optText(1000),
  failureReason: optText(300),
});

export async function advanceJobAction(jobId: string, payload: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    const f = advanceSchema.parse(JSON.parse(payload));
    await advanceJob(user.id, jobId, f.to, f);
    refresh();
  }, "Job updated.");
}

export async function reprintAction(jobId: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    const j = await reprintJob(user.id, jobId);
    refresh();
    return j.number;
  }, "Reprint queued.");
}

export async function cancelJobAction(jobId: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    await cancelJob(user.id, jobId);
    refresh();
  }, "Job canceled.");
}

export async function assignJobAction(jobId: string, printerId: string | null, plannedStart: string | null) {
  const user = await requireUser("production");
  return runAction(async () => {
    await assignJob(user.id, jobId, printerId || null, optDate().parse(plannedStart));
    refresh();
  }, "Job updated.");
}

export async function reorderJobAction(jobId: string, direction: "up" | "down") {
  await requireUser("production");
  return runAction(async () => {
    await reorderJob(jobId, direction === "up" ? "up" : "down");
    refresh();
  });
}
