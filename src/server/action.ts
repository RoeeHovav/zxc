import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrors } from "@/domain/schemas/common";
import { AuthError } from "./auth";
import { ServiceError } from "./services/common";

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string>; details?: Record<string, unknown> };

/**
 * Runs a server action body and maps known errors to user-safe results.
 * Unknown errors are logged server-side and reported generically (no stack traces to clients).
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(e) };
    if (e instanceof ServiceError) return { ok: false, error: e.message, details: e.details ?? serializeExtra(e) };
    if (e instanceof AuthError) return { ok: false, error: e.message };
    if (isPrismaKnown(e) && e.code === "P2002") return { ok: false, error: "A record with the same unique value already exists." };
    if (isPrismaKnown(e) && e.code === "P2025") return { ok: false, error: "The record was not found. It may have been changed or deleted." };
    if (isPrismaKnown(e) && e.code === "P2034") return { ok: false, error: "Another change happened at the same time. Please retry." };
    console.error("[action] unexpected error", e);
    return { ok: false, error: "Something went wrong. Nothing was saved. Please try again." };
  }
}

function serializeExtra(e: ServiceError): Record<string, unknown> | undefined {
  const extra = e as unknown as { candidates?: unknown };
  return extra.candidates ? { candidates: extra.candidates } : undefined;
}

function isPrismaKnown(e: unknown): e is { code: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string" && String((e as { code: string }).code).startsWith("P");
}
