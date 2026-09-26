import "server-only";
import type { Tx } from "../db";
import type { Prisma } from "@/generated/prisma/client";

/** A business-rule failure whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class NotFoundError extends ServiceError {
  constructor(what: string) {
    super(`${what} was not found. It may have been deleted.`);
    this.name = "NotFoundError";
  }
}

function isUniqueViolation(e: unknown) {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

/**
 * Makes a create operation safe to submit twice (double click, retry after a network error).
 * The unique `clientKey` column is the real guard: if two submissions race past the lookup,
 * the loser's transaction fails on the constraint and gets the winner's record instead.
 */
export async function idempotent<T>(key: string | null | undefined, find: (key: string) => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  if (!key) return create();
  const existing = await find(key);
  if (existing) return existing;
  try {
    return await create();
  } catch (e) {
    if (isUniqueViolation(e)) {
      const winner = await find(key);
      if (winner) return winner;
    }
    throw e;
  }
}

export type SequenceKey = "CUSTOMER" | "QUOTE" | "ORDER" | "JOB" | "PAYMENT" | "REFUND" | "DELIVERY" | "DESIGN" | "SPOOL";

const DEFAULTS: Record<SequenceKey, { prefix: string; includeYear: boolean; padding: number }> = {
  CUSTOMER: { prefix: "C", includeYear: false, padding: 4 },
  QUOTE: { prefix: "Q", includeYear: true, padding: 4 },
  ORDER: { prefix: "O", includeYear: true, padding: 4 },
  JOB: { prefix: "J", includeYear: false, padding: 5 },
  PAYMENT: { prefix: "PA", includeYear: true, padding: 4 },
  REFUND: { prefix: "RF", includeYear: true, padding: 4 },
  DELIVERY: { prefix: "DN", includeYear: true, padding: 4 },
  DESIGN: { prefix: "D", includeYear: false, padding: 4 },
  SPOOL: { prefix: "SP", includeYear: false, padding: 4 },
};

/**
 * Allocates the next document number atomically (row-level lock via UPDATE ... RETURNING).
 * Numbers are never reused; a rolled-back transaction also rolls back the increment.
 */
export async function nextNumber(tx: Tx, key: SequenceKey, now = new Date()): Promise<string> {
  const d = DEFAULTS[key];
  await tx.numberSequence.upsert({ where: { key }, create: { key, ...d, nextValue: 1 }, update: {} });
  const seq = await tx.numberSequence.update({ where: { key }, data: { nextValue: { increment: 1 } } });
  const value = seq.nextValue - 1;
  const n = String(value).padStart(seq.padding, "0");
  return seq.includeYear ? `${seq.prefix}-${now.getFullYear()}-${n}` : `${seq.prefix}-${n}`;
}

export async function audit(tx: Tx, entry: { userId?: string | null; entityType: string; entityId: string; action: string; summary: string; details?: Prisma.InputJsonValue }) {
  await tx.auditLog.create({ data: { ...entry, userId: entry.userId ?? null } });
}

/** Convert Prisma Decimal / null to string for serializable DTOs. */
export function s(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}
export function s0(value: { toString(): string } | null | undefined): string {
  return value === null || value === undefined ? "0" : value.toString();
}
