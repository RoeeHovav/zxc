/**
 * Display labels and tones for enums. Centralized so a Hebrew dictionary can
 * replace them (see docs/I18N.md) without touching components.
 */
import type { Tone } from "@/components/ui/misc";
import { dictionary } from "./i18n";

const L = dictionary.enums;

export function enumLabel(group: keyof typeof L, value: string | null | undefined): string {
  if (!value) return "—";
  const g = L[group] as Record<string, string>;
  return (
    g[value] ??
    value
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export const ORDER_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "muted",
  AWAITING_PAYMENT: "warning",
  AWAITING_MODELING: "info",
  AWAITING_APPROVAL: "warning",
  QUEUED: "neutral",
  PRINTING: "primary",
  POST_PROCESSING: "primary",
  QUALITY_CHECK: "primary",
  READY: "success",
  DELIVERED: "success",
  COMPLETED: "muted",
  CANCELED: "danger",
};

export const QUOTE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "muted",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
  REVISED: "muted",
};

export const JOB_STATUS_TONE: Record<string, Tone> = {
  QUEUED: "neutral",
  PRINTING: "primary",
  POST_PROCESSING: "info",
  QUALITY_CHECK: "warning",
  DONE: "success",
  FAILED: "danger",
  CANCELED: "muted",
};

export const DESIGN_STATUS_TONE: Record<string, Tone> = {
  REQUESTED: "neutral",
  IN_PROGRESS: "primary",
  AWAITING_APPROVAL: "warning",
  REVISION_REQUESTED: "info",
  APPROVED: "success",
  DELIVERED: "success",
  CANCELED: "muted",
};

export const PAYMENT_STATE_TONE: Record<string, Tone> = {
  UNPAID: "danger",
  DEPOSIT_PAID: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERPAID: "warning",
  REFUND_DUE: "warning",
  NOT_APPLICABLE: "muted",
};

export const PRINTER_STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: "success",
  PRINTING: "primary",
  MAINTENANCE: "warning",
  OFFLINE: "muted",
  RETIRED: "muted",
};
