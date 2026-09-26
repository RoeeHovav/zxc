"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { formToObject } from "@/domain/schemas/common";
import { designSchema, timeEntrySchema } from "@/domain/schemas/design";
import { billRevisions, completeRevision, deleteTimeEntry, logTime, requestRevision, saveDesign, transitionDesign } from "@/server/services/designs";

const refresh = (id: string) => {
  revalidatePath("/designs");
  revalidatePath(`/designs/${id}`);
  revalidatePath("/orders", "layout");
  revalidatePath("/dashboard");
};

export async function saveDesignAction(id: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("sales");
  return runAction(async () => {
    const d = await saveDesign(user.id, id, designSchema.parse(formToObject(fd)));
    refresh(d.id);
    return { id: d.id };
  });
}

export async function designStatusAction(id: string, to: string, note: string | null) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const target = z.enum(["REQUESTED", "IN_PROGRESS", "AWAITING_APPROVAL", "REVISION_REQUESTED", "APPROVED", "DELIVERED", "CANCELED"]).parse(to);
    await transitionDesign(user.id, id, target, note?.trim().slice(0, 300) || null);
    refresh(id);
  }, "Design updated.");
}

export async function logTimeAction(id: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await logTime(user.id, id, timeEntrySchema.parse(formToObject(fd)));
    refresh(id);
  }, "Time logged.");
}

export async function deleteTimeAction(id: string, entryId: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await deleteTimeEntry(user.id, entryId);
    refresh(id);
  }, "Entry removed.");
}

export async function requestRevisionAction(id: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const r = await requestRevision(user.id, id, String(fd.get("description") ?? ""));
    refresh(id);
    return r.isChargeable;
  }, "Revision recorded.");
}

export async function completeRevisionAction(id: string, revisionId: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await completeRevision(user.id, revisionId);
    refresh(id);
  }, "Revision completed.");
}

export async function billRevisionsAction(id: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const o = await billRevisions(user.id, id);
    refresh(id);
    return { orderId: o.id };
  }, "Draft order created for the additional work.");
}
