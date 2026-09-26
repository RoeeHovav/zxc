import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  canForceTransition,
  checkOrderTransition,
  paymentState,
  statusAfterConfirm,
  syncProductionStatus,
  type OrderFacts,
} from "./order";
import { checkDesignTransition, checkJobTransition, checkQuoteTransition, isQuoteExpired, isRevisionChargeable } from "./other";

function facts(over: Partial<OrderFacts> = {}): OrderFacts {
  return {
    status: "QUEUED",
    total: "100.00",
    amountPaid: "0.00",
    depositAmount: "0.00",
    requireDepositToProduce: true,
    items: [
      { partName: "Bracket", serviceType: "PRINT_ONLY", quantity: 4, quantityCompleted: 0, quantityPrinted: 0, designStatus: null, designFeeWaived: false },
      { partName: "Knob", serviceType: "PRINT_ONLY", quantity: 2, quantityCompleted: 0, quantityPrinted: 0, designStatus: null, designFeeWaived: false },
    ],
    jobs: [],
    ...over,
  };
}

const withItems = (f: OrderFacts, printed: number[], completed: number[]) => ({
  ...f,
  items: f.items.map((i, idx) => ({ ...i, quantityPrinted: printed[idx], quantityCompleted: completed[idx] })),
});

describe("order transitions", () => {
  it("has no transitions out of terminal states", () => {
    expect(ORDER_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELED).toEqual([]);
  });

  it("every transition target is a known status", () => {
    for (const s of ORDER_STATUSES) for (const t of ORDER_TRANSITIONS[s]) expect(ORDER_STATUSES).toContain(t);
  });

  it("rejects undefined jumps such as queued → delivered", () => {
    const r = checkOrderTransition(facts(), "DELIVERED");
    expect(r.ok).toBe(false);
  });

  it("cannot be marked ready after only one of two items is finished", () => {
    const f = withItems({ ...facts({ status: "QUALITY_CHECK", jobs: [{ number: "J-1", status: "DONE" }] }) }, [4, 0], [4, 0]);
    const r = checkOrderTransition(f, "READY");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].message).toContain("Knob (0/2)");
  });

  it("cannot enter quality check until every unit is printed", () => {
    const f = withItems(facts({ status: "PRINTING" }), [4, 1], [0, 0]);
    expect(checkOrderTransition(f, "QUALITY_CHECK").ok).toBe(false);
    expect(checkOrderTransition(withItems(f, [4, 2], [0, 0]), "QUALITY_CHECK").ok).toBe(true);
  });

  it("requires the deposit before production unless overridden with a reason", () => {
    const f = facts({ status: "AWAITING_PAYMENT", depositAmount: "50.00", amountPaid: "20.00" });
    const r = checkOrderTransition(f, "QUEUED");
    expect(r.ok).toBe(false);
    expect(canForceTransition(r, "")).toBe(false);
    expect(canForceTransition(r, "Trusted repeat customer")).toBe(true);
    expect(checkOrderTransition({ ...f, amountPaid: "50.00" }, "QUEUED").ok).toBe(true);
  });

  it("blocks completion with an outstanding balance or overpayment", () => {
    const delivered = facts({ status: "DELIVERED", amountPaid: "60.00" });
    const r = checkOrderTransition(delivered, "COMPLETED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].message).toContain("Outstanding balance of 40.00");
    expect(checkOrderTransition({ ...delivered, amountPaid: "100.00" }, "COMPLETED").ok).toBe(true);
    expect(checkOrderTransition({ ...delivered, amountPaid: "120.00" }, "COMPLETED").ok).toBe(false);
  });

  it("cannot cancel while a job is printing", () => {
    const r = checkOrderTransition(facts({ status: "PRINTING", jobs: [{ number: "J-7", status: "PRINTING" }] }), "CANCELED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].overridable).toBe(false);
  });

  it("requires modeling approval before queueing (hard guard is overridable only with reason)", () => {
    const f = facts({
      status: "AWAITING_MODELING",
      items: [{ partName: "Custom gear", serviceType: "MODELING_AND_PRINTING", quantity: 1, quantityCompleted: 0, quantityPrinted: 0, designStatus: "IN_PROGRESS", designFeeWaived: false }],
    });
    expect(checkOrderTransition(f, "QUEUED").ok).toBe(false);
    expect(checkOrderTransition({ ...f, items: [{ ...f.items[0], designStatus: "APPROVED" }] }, "QUEUED").ok).toBe(true);
  });

  it("requires a started job before manually marking printing", () => {
    expect(checkOrderTransition(facts(), "PRINTING").ok).toBe(false);
    expect(checkOrderTransition(facts({ jobs: [{ number: "J-1", status: "PRINTING" }] }), "PRINTING").ok).toBe(true);
  });
});

describe("statusAfterConfirm", () => {
  it("routes to awaiting payment when a deposit is required and unpaid", () => {
    expect(statusAfterConfirm(facts({ status: "DRAFT", depositAmount: "30" }))).toBe("AWAITING_PAYMENT");
  });
  it("routes to awaiting modeling when a design is not approved", () => {
    const f = facts({
      status: "DRAFT",
      items: [{ partName: "X", serviceType: "MODELING_AND_PRINTING", quantity: 1, quantityCompleted: 0, quantityPrinted: 0, designStatus: null, designFeeWaived: false }],
    });
    expect(statusAfterConfirm(f)).toBe("AWAITING_MODELING");
  });
  it("skips modeling for reorders of an existing design", () => {
    const f = facts({
      status: "DRAFT",
      items: [{ partName: "X", serviceType: "MODELING_AND_PRINTING", quantity: 1, quantityCompleted: 0, quantityPrinted: 0, designStatus: "DELIVERED", designFeeWaived: true }],
    });
    expect(statusAfterConfirm(f)).toBe("QUEUED");
  });
  it("routes plain print orders to the queue", () => {
    expect(statusAfterConfirm(facts({ status: "DRAFT" }))).toBe("QUEUED");
  });
});

describe("syncProductionStatus", () => {
  it("moves a queued order to printing when a job starts", () => {
    expect(syncProductionStatus(facts({ jobs: [{ number: "J-1", status: "PRINTING" }] }))).toBe("PRINTING");
  });
  it("stays printing while any unit is unprinted, even if one job finished", () => {
    const f = withItems(facts({ status: "PRINTING", jobs: [{ number: "J-1", status: "DONE" }, { number: "J-2", status: "QUEUED" }] }), [4, 0], [4, 0]);
    expect(syncProductionStatus(f)).toBeNull();
  });
  it("becomes ready only when every unit of every item passed QC", () => {
    const f = withItems(facts({ status: "PRINTING", jobs: [{ number: "J-1", status: "DONE" }, { number: "J-2", status: "DONE" }] }), [4, 2], [4, 2]);
    expect(syncProductionStatus(f)).toBe("READY");
  });
  it("returns to printing when a QC failure triggers a reprint", () => {
    const f = withItems(
      facts({ status: "QUALITY_CHECK", jobs: [{ number: "J-1", status: "DONE" }, { number: "J-2", status: "FAILED" }, { number: "J-3", status: "QUEUED" }] }),
      [4, 0],
      [4, 0],
    );
    expect(syncProductionStatus(f)).toBe("PRINTING");
  });
  it("reflects post-processing and QC phases", () => {
    const base = withItems(facts({ status: "PRINTING" }), [4, 2], [0, 0]);
    expect(syncProductionStatus({ ...base, jobs: [{ number: "J-1", status: "POST_PROCESSING" }] })).toBe("POST_PROCESSING");
    expect(syncProductionStatus({ ...base, jobs: [{ number: "J-1", status: "QUALITY_CHECK" }] })).toBe("QUALITY_CHECK");
  });
  it("ignores orders outside the production band", () => {
    expect(syncProductionStatus(facts({ status: "DELIVERED" }))).toBeNull();
    expect(syncProductionStatus(facts({ status: "AWAITING_PAYMENT", jobs: [{ number: "J-1", status: "PRINTING" }] }))).toBeNull();
  });
});

describe("paymentState", () => {
  const p = (total: string, paid: string, status: OrderFacts["status"] = "QUEUED", deposit = "0") =>
    paymentState({ total, amountPaid: paid, status, depositAmount: deposit });
  it("derives states from the ledger", () => {
    expect(p("100", "0")).toBe("UNPAID");
    expect(p("100", "30", "QUEUED", "30")).toBe("DEPOSIT_PAID");
    expect(p("100", "20", "QUEUED", "30")).toBe("PARTIALLY_PAID");
    expect(p("100", "100")).toBe("PAID");
    expect(p("100", "120")).toBe("OVERPAID");
    expect(p("100", "50", "CANCELED")).toBe("REFUND_DUE");
    expect(p("100", "0", "CANCELED")).toBe("NOT_APPLICABLE");
  });
});

describe("quote transitions", () => {
  const q = { status: "DRAFT" as const, itemCount: 1, pricingComplete: true, validUntil: new Date(Date.now() + 86400000), hasOrder: false };
  it("sends only complete, dated quotes", () => {
    expect(checkQuoteTransition(q, "SENT")).toEqual([]);
    expect(checkQuoteTransition({ ...q, pricingComplete: false }, "SENT").length).toBe(1);
    expect(checkQuoteTransition({ ...q, validUntil: null }, "SENT").length).toBe(1);
    expect(checkQuoteTransition({ ...q, itemCount: 0 }, "SENT").length).toBe(1);
  });
  it("cannot accept a draft or an expired quote", () => {
    expect(checkQuoteTransition(q, "ACCEPTED").length).toBe(1);
    expect(checkQuoteTransition({ ...q, status: "SENT", validUntil: new Date("2020-01-01") }, "ACCEPTED").length).toBe(1);
  });
  it("detects expiry", () => {
    expect(isQuoteExpired("SENT", new Date("2020-01-01"))).toBe(true);
    expect(isQuoteExpired("DRAFT", new Date("2020-01-01"))).toBe(false);
  });
  it("accepted and revised quotes are final", () => {
    expect(checkQuoteTransition({ ...q, status: "ACCEPTED" }, "REVISED").length).toBe(1);
    expect(checkQuoteTransition({ ...q, status: "REVISED" }, "SENT").length).toBe(1);
  });
});

describe("job & design transitions", () => {
  it("allows the documented job flow and blocks reopening", () => {
    expect(checkJobTransition("QUEUED", "PRINTING")).toEqual([]);
    expect(checkJobTransition("PRINTING", "FAILED")).toEqual([]);
    expect(checkJobTransition("DONE", "PRINTING").length).toBe(1);
    expect(checkJobTransition("QUEUED", "DONE").length).toBe(1);
  });
  it("allows design approval and revisions", () => {
    expect(checkDesignTransition("AWAITING_APPROVAL", "APPROVED")).toEqual([]);
    expect(checkDesignTransition("REQUESTED", "APPROVED").length).toBe(1);
    expect(isRevisionChargeable(3, 2)).toBe(true);
    expect(isRevisionChargeable(2, 2)).toBe(false);
  });
});
