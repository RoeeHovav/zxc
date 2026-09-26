/**
 * Order lifecycle. Order status is distinct from print-job status and payment
 * status; guards below make sure they cannot contradict each other.
 */
import { dec, ZERO } from "../money";
import { requiresModeling, requiresPrint } from "../pricing/engine";

export const ORDER_STATUSES = [
  "DRAFT",
  "AWAITING_PAYMENT",
  "AWAITING_MODELING",
  "AWAITING_APPROVAL",
  "QUEUED",
  "PRINTING",
  "POST_PROCESSING",
  "QUALITY_CHECK",
  "READY",
  "DELIVERED",
  "COMPLETED",
  "CANCELED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELED"];
/** Statuses in which inventory is reserved and production may happen. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL", "QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "READY"];
/** Line items can be edited (order revision) only before production output exists. */
export const EDITABLE_ORDER_STATUSES: OrderStatus[] = ["DRAFT", "AWAITING_PAYMENT", "AWAITING_MODELING", "AWAITING_APPROVAL", "QUEUED"];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["AWAITING_PAYMENT", "AWAITING_MODELING", "QUEUED", "CANCELED"],
  AWAITING_PAYMENT: ["AWAITING_MODELING", "QUEUED", "CANCELED"],
  AWAITING_MODELING: ["AWAITING_APPROVAL", "QUEUED", "CANCELED"],
  AWAITING_APPROVAL: ["AWAITING_MODELING", "QUEUED", "CANCELED"],
  QUEUED: ["PRINTING", "AWAITING_MODELING", "READY", "CANCELED"],
  PRINTING: ["QUEUED", "POST_PROCESSING", "QUALITY_CHECK", "READY", "CANCELED"],
  POST_PROCESSING: ["PRINTING", "QUALITY_CHECK", "READY", "CANCELED"],
  QUALITY_CHECK: ["PRINTING", "POST_PROCESSING", "READY", "CANCELED"],
  READY: ["QUALITY_CHECK", "DELIVERED", "CANCELED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELED: [],
};

export type DesignStatusLike = "REQUESTED" | "IN_PROGRESS" | "AWAITING_APPROVAL" | "REVISION_REQUESTED" | "APPROVED" | "DELIVERED" | "CANCELED";

export interface OrderFacts {
  status: OrderStatus;
  total: string;
  amountPaid: string;
  depositAmount: string;
  requireDepositToProduce: boolean;
  items: {
    partName: string;
    serviceType: string;
    quantity: number;
    /** Units that passed QC in completed jobs. */
    quantityCompleted: number;
    /** Units whose printing finished (in post-processing, QC or done). */
    quantityPrinted: number;
    designStatus: DesignStatusLike | null;
    designFeeWaived: boolean;
  }[];
  jobs: { number: string; status: string }[];
}

export interface GuardFailure {
  message: string;
  /** Overridable guards may be bypassed with a recorded reason. */
  overridable: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; failures: GuardFailure[] };

export function balanceDue(facts: Pick<OrderFacts, "total" | "amountPaid" | "status">) {
  const total = facts.status === "CANCELED" ? ZERO : dec(facts.total);
  return total.minus(dec(facts.amountPaid));
}

export type PaymentState = "UNPAID" | "DEPOSIT_PAID" | "PARTIALLY_PAID" | "PAID" | "OVERPAID" | "REFUND_DUE" | "NOT_APPLICABLE";

/** Derived payment state — never stored, so it cannot drift from the payments ledger. */
export function paymentState(facts: Pick<OrderFacts, "total" | "amountPaid" | "status" | "depositAmount">): PaymentState {
  const paid = dec(facts.amountPaid);
  if (facts.status === "CANCELED") return paid.gt(0) ? "REFUND_DUE" : "NOT_APPLICABLE";
  const total = dec(facts.total);
  if (total.eq(0) && paid.eq(0)) return "NOT_APPLICABLE";
  if (paid.lte(0)) return "UNPAID";
  if (paid.eq(total)) return "PAID";
  if (paid.gt(total)) return "OVERPAID";
  const deposit = dec(facts.depositAmount);
  if (deposit.gt(0) && paid.gte(deposit)) return "DEPOSIT_PAID";
  return "PARTIALLY_PAID";
}

export function depositSatisfied(facts: OrderFacts): boolean {
  const deposit = dec(facts.depositAmount);
  return deposit.lte(0) || dec(facts.amountPaid).gte(deposit);
}

const designReady = (s: DesignStatusLike | null) => s === "APPROVED" || s === "DELIVERED";

function modelingPending(facts: OrderFacts) {
  return facts.items.filter((i) => requiresModeling(i.serviceType) && !i.designFeeWaived && !designReady(i.designStatus));
}

function printItems(facts: OrderFacts) {
  return facts.items.filter((i) => requiresPrint(i.serviceType));
}

function serviceItemsPending(facts: OrderFacts) {
  return facts.items.filter((i) => !requiresPrint(i.serviceType) && i.designStatus !== null && !designReady(i.designStatus));
}

/** Checks whether `to` is a valid next status, including business guards. */
export function checkOrderTransition(facts: OrderFacts, to: OrderStatus): TransitionCheck {
  const from = facts.status;
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return { ok: false, failures: [{ message: `An order cannot move from ${label(from)} to ${label(to)}.`, overridable: false }] };
  }
  const failures: GuardFailure[] = [];
  const fail = (message: string, overridable = false) => failures.push({ message, overridable });

  if (from === "DRAFT" && to !== "CANCELED" && facts.items.length === 0) fail("Add at least one item before confirming the order.");

  switch (to) {
    case "AWAITING_PAYMENT":
      if (dec(facts.depositAmount).lte(0)) fail("This order has no deposit requirement.");
      break;
    case "AWAITING_MODELING":
      if (modelingPending(facts).length === 0 && facts.items.every((i) => !requiresModeling(i.serviceType))) fail("No item on this order requires modeling.");
      break;
    case "AWAITING_APPROVAL":
      break;
    case "QUEUED": {
      if (facts.requireDepositToProduce && !depositSatisfied(facts)) fail(`Deposit of ${dec(facts.depositAmount).toFixed(2)} has not been received (paid ${dec(facts.amountPaid).toFixed(2)}).`, true);
      const pending = modelingPending(facts);
      if (pending.length > 0) fail(`Design not yet approved for: ${pending.map((p) => p.partName).join(", ")}.`, true);
      if (from === "PRINTING" && facts.jobs.some((j) => j.status === "PRINTING")) fail("A print job is still printing. Finish, fail or undo it first.");
      break;
    }
    case "PRINTING":
      if (!facts.jobs.some((j) => ["PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "DONE"].includes(j.status))) fail("Start a print job for this order first (Production board).");
      break;
    case "POST_PROCESSING":
    case "QUALITY_CHECK": {
      const unprinted = printItems(facts).filter((i) => i.quantityPrinted < i.quantity);
      if (unprinted.length > 0) fail(`Printing is not finished for: ${unprinted.map((i) => `${i.partName} (${i.quantityPrinted}/${i.quantity})`).join(", ")}.`);
      break;
    }
    case "READY": {
      const incomplete = printItems(facts).filter((i) => i.quantityCompleted < i.quantity);
      if (incomplete.length > 0) fail(`Not all units have passed quality check: ${incomplete.map((i) => `${i.partName} (${i.quantityCompleted}/${i.quantity})`).join(", ")}.`);
      const pendingDesigns = [...modelingPending(facts), ...serviceItemsPending(facts)];
      if (pendingDesigns.length > 0) fail(`Design/scan work not approved for: ${pendingDesigns.map((p) => p.partName).join(", ")}.`);
      if (facts.jobs.some((j) => ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"].includes(j.status))) fail("There are unfinished print jobs. Complete or cancel them first.");
      break;
    }
    case "DELIVERED":
      break;
    case "COMPLETED": {
      const balance = balanceDue(facts);
      if (balance.gt(0)) fail(`Outstanding balance of ${balance.toFixed(2)}. Record the payment before completing.`, true);
      if (balance.lt(0)) fail(`Customer has overpaid by ${balance.neg().toFixed(2)}. Record a refund before completing.`, true);
      break;
    }
    case "CANCELED": {
      const printing = facts.jobs.filter((j) => j.status === "PRINTING");
      if (printing.length > 0) fail(`Job ${printing.map((j) => j.number).join(", ")} is printing. Stop it (mark failed) before canceling.`);
      break;
    }
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}

/** Passes if all failures are overridable and a reason is given. */
export function canForceTransition(check: TransitionCheck, reason: string | null | undefined): boolean {
  if (check.ok) return true;
  return check.failures.every((f) => f.overridable) && !!reason && reason.trim().length >= 3;
}

/** The status an order should enter when confirmed from DRAFT. */
export function statusAfterConfirm(facts: OrderFacts): OrderStatus {
  if (facts.requireDepositToProduce && !depositSatisfied(facts)) return "AWAITING_PAYMENT";
  if (modelingPending(facts).length > 0) return "AWAITING_MODELING";
  if (printItems(facts).length === 0) return serviceItemsPending(facts).length ? "AWAITING_MODELING" : "READY";
  return "QUEUED";
}

export const PRODUCTION_BAND: OrderStatus[] = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK"];

/**
 * Derives the production-phase status from print jobs so order status and job
 * status never contradict each other. Only applies while the order is in the
 * production band; returns the target status, or null if no change is needed.
 *  - some units not printed yet → PRINTING if any job has started, else QUEUED
 *  - all printed, a job in post-processing → POST_PROCESSING
 *  - all printed, a job in QC (or units failed QC awaiting reprint) → QUALITY_CHECK
 *  - every unit passed QC and designs approved → READY
 */
export function syncProductionStatus(facts: OrderFacts): OrderStatus | null {
  if (!PRODUCTION_BAND.includes(facts.status)) return null;
  const items = printItems(facts);
  if (items.length === 0) return null;
  const started = facts.jobs.some((j) => ["PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"].includes(j.status));
  let target: OrderStatus;
  if (items.some((i) => i.quantityPrinted < i.quantity)) {
    target = started ? "PRINTING" : "QUEUED";
  } else if (facts.jobs.some((j) => j.status === "POST_PROCESSING")) {
    target = "POST_PROCESSING";
  } else if (facts.jobs.some((j) => j.status === "QUALITY_CHECK")) {
    target = "QUALITY_CHECK";
  } else if (items.every((i) => i.quantityCompleted >= i.quantity)) {
    target = checkOrderTransition({ ...facts, status: "QUALITY_CHECK" }, "READY").ok ? "READY" : "QUALITY_CHECK";
  } else {
    target = "QUALITY_CHECK";
  }
  return target === facts.status ? null : target;
}

export function label(status: OrderStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
