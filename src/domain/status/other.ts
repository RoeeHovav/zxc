/** Quote, print-job and design-project lifecycles. */

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "REVISED";

export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "REVISED"],
  ACCEPTED: [],
  REJECTED: ["REVISED"],
  EXPIRED: ["REVISED", "SENT"],
  REVISED: [],
};

export interface QuoteFacts {
  status: QuoteStatus;
  itemCount: number;
  pricingComplete: boolean;
  validUntil: Date | null;
  hasOrder: boolean;
}

export function checkQuoteTransition(q: QuoteFacts, to: QuoteStatus, now = new Date()): string[] {
  if (!QUOTE_TRANSITIONS[q.status].includes(to)) return [`A quote cannot move from ${q.status.toLowerCase()} to ${to.toLowerCase()}.`];
  const errors: string[] = [];
  if (to === "SENT") {
    if (q.itemCount === 0) errors.push("Add at least one item.");
    if (!q.pricingComplete) errors.push("Resolve all pricing errors before sending.");
    if (!q.validUntil) errors.push("Set a validity date.");
    else if (q.validUntil < startOfDay(now)) errors.push("The validity date is in the past. Extend it first.");
  }
  if (to === "ACCEPTED" && q.validUntil && q.validUntil < startOfDay(now)) errors.push("This quote has expired. Revise or re-send it before accepting.");
  if (to === "REVISED" && q.hasOrder) errors.push("This quote already has an order.");
  return errors;
}

export function isQuoteEditable(status: QuoteStatus) {
  return status === "DRAFT";
}

/** A sent quote past its validity date is effectively expired. */
export function isQuoteExpired(status: QuoteStatus, validUntil: Date | null, now = new Date()) {
  return status === "SENT" && validUntil !== null && validUntil < startOfDay(now);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ───────────── Print jobs ─────────────

export type JobStatus = "QUEUED" | "PRINTING" | "POST_PROCESSING" | "QUALITY_CHECK" | "DONE" | "FAILED" | "CANCELED";

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["PRINTING", "CANCELED"],
  PRINTING: ["QUEUED", "POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"],
  POST_PROCESSING: ["QUALITY_CHECK", "DONE", "FAILED"],
  QUALITY_CHECK: ["POST_PROCESSING", "DONE", "FAILED"],
  DONE: [],
  FAILED: [],
  CANCELED: [],
};

export const OPEN_JOB_STATUSES: JobStatus[] = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"];

export function checkJobTransition(from: JobStatus, to: JobStatus): string[] {
  return JOB_TRANSITIONS[from].includes(to) ? [] : [`A print job cannot move from ${from.toLowerCase()} to ${to.toLowerCase().replace("_", " ")}.`];
}

// ───────────── Design projects ─────────────

export type DesignStatus = "REQUESTED" | "IN_PROGRESS" | "AWAITING_APPROVAL" | "REVISION_REQUESTED" | "APPROVED" | "DELIVERED" | "CANCELED";

export const DESIGN_TRANSITIONS: Record<DesignStatus, DesignStatus[]> = {
  REQUESTED: ["IN_PROGRESS", "CANCELED"],
  IN_PROGRESS: ["AWAITING_APPROVAL", "CANCELED"],
  AWAITING_APPROVAL: ["APPROVED", "REVISION_REQUESTED", "CANCELED"],
  REVISION_REQUESTED: ["IN_PROGRESS", "CANCELED"],
  APPROVED: ["DELIVERED", "REVISION_REQUESTED"],
  DELIVERED: ["REVISION_REQUESTED"],
  CANCELED: [],
};

export function checkDesignTransition(from: DesignStatus, to: DesignStatus): string[] {
  return DESIGN_TRANSITIONS[from].includes(to) ? [] : [`A design cannot move from ${from.toLowerCase()} to ${to.toLowerCase()}.`];
}

/** Revision N is chargeable when it exceeds the included revision allowance. */
export function isRevisionChargeable(revisionNumber: number, includedRevisions: number) {
  return revisionNumber > includedRevisions;
}
