"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { quoteSchema } from "@/domain/schemas/sales";
import { ServiceError } from "@/server/services/common";
import { acceptQuote, convertAcceptedQuote, deleteDraftQuote, rejectQuote, reviseQuote, saveQuote, sendQuote } from "@/server/services/quotes";

function parsePayload(payload: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new ServiceError("The form data was malformed.");
  }
  return quoteSchema.parse(raw);
}

export async function saveQuoteAction(id: string | null, payload: string, clientKey: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("sales");
  return runAction(async () => {
    const q = await saveQuote(user.id, id, parsePayload(payload), id ? null : clientKey.slice(0, 64));
    revalidatePath("/quotes");
    return { id: q.id };
  });
}

const refresh = (id: string) => {
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/dashboard");
};

export async function sendQuoteAction(id: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await sendQuote(user.id, id);
    refresh(id);
  }, "Quote marked as sent.");
}

export async function acceptQuoteAction(id: string, note: string, createOrder: boolean) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const r = await acceptQuote(user.id, id, note.trim().slice(0, 300) || null, createOrder);
    refresh(id);
    revalidatePath("/orders");
    return r;
  }, createOrder ? "Accepted — order created." : "Quote accepted.");
}

export async function convertQuoteAction(id: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const r = await convertAcceptedQuote(user.id, id);
    refresh(id);
    revalidatePath("/orders");
    return r;
  }, "Order created.");
}

export async function rejectQuoteAction(id: string, reason: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await rejectQuote(user.id, id, reason.trim().slice(0, 300) || null);
    refresh(id);
  }, "Quote marked as rejected.");
}

export async function reviseQuoteAction(id: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    const q = await reviseQuote(user.id, id);
    refresh(id);
    return { id: q.id };
  }, "New revision created.");
}

export async function deleteQuoteAction(id: string) {
  const user = await requireUser("sales");
  return runAction(async () => {
    await deleteDraftQuote(user.id, id);
    revalidatePath("/quotes");
  }, "Draft deleted.");
}
