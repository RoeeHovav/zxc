import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { saveQuote, sendQuote, acceptQuote, reviseQuote, getQuote } from "@/server/services/quotes";
import { saveOrder, transitionOrder, computeActualCost } from "@/server/services/orders";
import { recordPayment, verifyPaymentCaches, voidPayment } from "@/server/services/payments";
import { createJobsForOrder, finishPrint, startJob, advanceJob, reprintJob } from "@/server/services/production";
import { stockSummaries } from "@/server/services/materials";
import { addSpool, orderForm, printLine, quoteForm, seedBasics } from "./helpers";
import type { LineForm } from "@/domain/schemas/sales";

let base: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  base = await seedBasics();
});

describe("customer → quote → order → production → payment → completion", () => {
  let quoteId: string;
  let orderId: string;

  it("creates a multi-item quote priced by the engine", async () => {
    const { material, printer, customer, user } = base;
    const q = await saveQuote(
      user.id,
      null,
      quoteForm(customer.id, [
        printLine(material.id, printer.id), // 4 × (5 material + 10 machine) = 60 cost → 30/unit → 120
        printLine(material.id, printer.id, { partName: "Custom knob", serviceType: "MODELING_AND_PRINTING", quantity: 2, modelingMode: "HOURLY", modelingHours: "2" }), // 2×30 + 360
        printLine(material.id, printer.id, { partName: "Scan of vase", serviceType: "SCANNING_ONLY", quantity: 1, scanHours: "1", materialId: null, printerId: null }), // 200
      ]),
    );
    quoteId = q.id;
    expect(q.pricingComplete).toBe(true);
    expect(q.itemsNet.toString()).toBe("740");
    expect(q.vatAmount.toString()).toBe("133.2");
    expect(q.total.toString()).toBe("873.2");
    expect(q.number).toMatch(/^Q-\d{4}-0001$/);
  });

  it("preserves the quote's original prices when material price and VAT change", async () => {
    await prisma.material.update({ where: { id: base.material.id }, data: { pricePerKg: "300" } });
    await prisma.settings.update({ where: { id: 1 }, data: { vatRate: "0.2", laborCostPerHour: "999" } });
    const quote = await getQuote(quoteId);
    expect(quote!.total.toString()).toBe("873.2");
    // Re-saving the draft without "refresh" keeps the snapshot.
    const form = quoteForm(
      base.customer.id,
      quote!.items.map((it) => ({ ...(it.pricingInput as unknown as { form: LineForm }).form, id: it.id, deadline: null })),
    );
    const resaved = await saveQuote(base.user.id, quoteId, form);
    expect(resaved.total.toString()).toBe("873.2");
    // Explicit re-price uses current rates.
    const repriced = await saveQuote(base.user.id, quoteId, { ...form, refreshRates: true });
    expect(repriced.total.toString()).not.toBe("873.2");
    // Restore the original snapshot state for the rest of the flow.
    await prisma.material.update({ where: { id: base.material.id }, data: { pricePerKg: "100" } });
    await prisma.settings.update({ where: { id: 1 }, data: { vatRate: "0.18", laborCostPerHour: "60" } });
    const back = await saveQuote(base.user.id, quoteId, { ...form, refreshRates: true });
    expect(back.total.toString()).toBe("873.2");
  });

  it("sends, accepts and converts to an order with reservations and a design project", async () => {
    await sendQuote(base.user.id, quoteId);
    const res = await acceptQuote(base.user.id, quoteId, "Approved by phone", true);
    orderId = res.orderId!;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { reservations: true, designProject: true } } } });
    expect(order.total.toString()).toBe("873.2");
    expect(order.status).toBe("AWAITING_MODELING");
    const knob = order.items.find((i) => i.partName === "Custom knob")!;
    expect(knob.designProject?.status).toBe("REQUESTED");
    const bracket = order.items.find((i) => i.partName === "Bracket")!;
    expect(bracket.reservations[0].quantityG.toString()).toBe("200");
    const stock = (await stockSummaries([base.material.id])).get(base.material.id)!;
    expect(stock.reservedG).toBe("300.00");
    // An accepted quote is final.
    await expect(reviseQuote(base.user.id, quoteId)).rejects.toThrow();
  });

  it("refuses to queue until the design is approved", async () => {
    await expect(transitionOrder(base.user.id, orderId, "QUEUED")).rejects.toThrow(/Design not yet approved/);
    const knob = await prisma.orderItem.findFirstOrThrow({ where: { orderId, partName: "Custom knob" } });
    const scan = await prisma.orderItem.findFirstOrThrow({ where: { orderId, partName: "Scan of vase" } });
    await prisma.designProject.updateMany({ where: { id: { in: [knob.designProjectId!, scan.designProjectId!] } }, data: { status: "APPROVED" } });
    await transitionOrder(base.user.id, orderId, "QUEUED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("QUEUED");
  });

  it("cannot be marked ready while units are unprinted", async () => {
    await expect(transitionOrder(base.user.id, orderId, "READY")).rejects.toThrow(/Not all units/);
  });

  it("runs jobs: consumption deducts spools and reservations; order status follows jobs", async () => {
    const spool = await addSpool(base.material.id, "1000", "SP-A");
    const jobs = await createJobsForOrder(base.user.id, orderId);
    expect(jobs.length).toBe(3); // bracket 4 units / 2 per batch = 2 jobs, knob 2 units / 2 per batch = 1 job
    const all = await prisma.printJob.findMany({ where: { orderId }, include: { items: true }, orderBy: { number: "asc" } });

    await startJob(base.user.id, all[0].id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PRINTING");
    // Printer is busy — a second job cannot start on it.
    await expect(startJob(base.user.id, all[1].id)).rejects.toThrow(/already printing/);

    await finishPrint(base.user.id, all[0].id, {
      outcome: "DONE",
      actualMinutes: "240",
      consumption: [{ spoolId: spool.id, materialId: null, grams: "100" }],
      good: {},
      failureReason: null,
      notes: null,
    });
    const afterFirst = await prisma.spool.findUniqueOrThrow({ where: { id: spool.id } });
    expect(afterFirst.remainingG.toString()).toBe("900");
    // One job done out of several: the order must still be printing, not ready.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PRINTING");

    // Second bracket job fails; reprint is queued; reservation is not reduced by waste.
    await startJob(base.user.id, all[1].id);
    await finishPrint(base.user.id, all[1].id, {
      outcome: "FAILED",
      actualMinutes: "30",
      consumption: [{ spoolId: spool.id, materialId: null, grams: "20" }],
      good: {},
      failureReason: "Spaghetti — bed adhesion",
      notes: null,
    });
    const re = await reprintJob(base.user.id, all[1].id);
    await startJob(base.user.id, re.id);
    await finishPrint(base.user.id, re.id, {
      outcome: "QUALITY_CHECK",
      actualMinutes: "240",
      consumption: [{ spoolId: spool.id, materialId: null, grams: "100" }],
      good: {},
      failureReason: null,
      notes: null,
    });
    await advanceJob(base.user.id, re.id, "DONE", { good: {} });

    await startJob(base.user.id, all[2].id);
    await finishPrint(base.user.id, all[2].id, {
      outcome: "DONE",
      actualMinutes: "240",
      consumption: [{ spoolId: spool.id, materialId: null, grams: "100" }],
      good: {},
      failureReason: null,
      notes: null,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { reservations: true } } } });
    expect(order.status).toBe("READY");
    const bracket = order.items.find((i) => i.partName === "Bracket")!;
    expect(bracket.quantityCompleted).toBe(4);
    expect(bracket.reservations[0].status).toBe("CONSUMED");
    const spoolAfter = await prisma.spool.findUniqueOrThrow({ where: { id: spool.id } });
    expect(spoolAfter.remainingG.toString()).toBe("680");
    const failed = await prisma.stockMovement.findFirstOrThrow({ where: { type: "FAILED_PRINT" } });
    expect(failed.quantityG.toString()).toBe("-20");
  });

  it("handles deposits, partial payments, overpayment and refunds", async () => {
    await expect(
      recordPayment(base.user.id, orderId, { kind: "PAYMENT", method: "BIT", amount: "900", isDeposit: false, receivedAt: null, reference: null, feeAmount: null, notes: null, idempotencyKey: null }),
    ).rejects.toThrow(/exceeds the balance/);
    await recordPayment(base.user.id, orderId, {
      kind: "PAYMENT",
      method: "BIT",
      amount: "300",
      isDeposit: true,
      receivedAt: null,
      reference: null,
      feeAmount: null,
      notes: null,
      idempotencyKey: "k1",
    });
    // Duplicate submission with the same key is ignored.
    await recordPayment(base.user.id, orderId, {
      kind: "PAYMENT",
      method: "BIT",
      amount: "300",
      isDeposit: true,
      receivedAt: null,
      reference: null,
      feeAmount: null,
      notes: null,
      idempotencyKey: "k1",
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).amountPaid.toString()).toBe("300");
    await expect(
      recordPayment(base.user.id, orderId, { kind: "REFUND", method: "BIT", amount: "301", isDeposit: false, receivedAt: null, reference: null, feeAmount: null, notes: null, idempotencyKey: null }),
    ).rejects.toThrow(/cannot exceed/);
    await transitionOrder(base.user.id, orderId, "DELIVERED");
    await expect(transitionOrder(base.user.id, orderId, "COMPLETED")).rejects.toThrow(/Outstanding balance of 573.20/);
    await recordPayment(base.user.id, orderId, {
      kind: "PAYMENT",
      method: "CASH",
      amount: "573.20",
      isDeposit: false,
      receivedAt: null,
      reference: null,
      feeAmount: null,
      notes: null,
      idempotencyKey: null,
    });
    await transitionOrder(base.user.id, orderId, "COMPLETED");
    const done = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(done.status).toBe("COMPLETED");
    expect(done.deliveryNoteNumber).toMatch(/^DN-/);
    expect(done.actualCost).not.toBeNull();
    expect(await verifyPaymentCaches()).toEqual([]);
  });

  it("computes actual cost from real consumption and machine time", async () => {
    const actual = await computeActualCost(prisma, orderId);
    // 320 g at 90/kg = 28.80 ; machine (240+30+240+240) min = 12.5 h × 5 = 62.50
    expect(actual.material).toBe("28.80");
    expect(actual.machine).toBe("62.50");
  });
});

describe("cancellation, revisions and edits", () => {
  it("releases reservations and cancels queued jobs when an order is canceled", async () => {
    const { user, customer, material, printer } = base;
    const o = await saveOrder(user.id, null, orderForm(customer.id, [printLine(material.id, printer.id, { quantity: 2 })], { confirm: true }));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("QUEUED");
    await createJobsForOrder(user.id, o.id);
    await recordPayment(user.id, o.id, { kind: "PAYMENT", method: "CASH", amount: "20", isDeposit: true, receivedAt: null, reference: null, feeAmount: null, notes: null, idempotencyKey: null });
    await transitionOrder(user.id, o.id, "CANCELED", "Customer changed mind");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: { include: { reservations: true } }, jobs: true } });
    expect(after.items[0].reservations.every((r) => r.status === "RELEASED")).toBe(true);
    expect(after.jobs.every((j) => j.status === "CANCELED")).toBe(true);
    // Payment on a canceled order is refused; a partial refund is allowed.
    await expect(
      recordPayment(user.id, o.id, { kind: "PAYMENT", method: "CASH", amount: "1", isDeposit: false, receivedAt: null, reference: null, feeAmount: null, notes: null, idempotencyKey: null }),
    ).rejects.toThrow(/canceled/);
    await recordPayment(user.id, o.id, { kind: "REFUND", method: "CASH", amount: "15", isDeposit: false, receivedAt: null, reference: null, feeAmount: null, notes: null, idempotencyKey: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).amountPaid.toString()).toBe("5");
  });

  it("revises a confirmed order but protects items that are already in production", async () => {
    const { user, customer, material, printer } = base;
    const o = await saveOrder(user.id, null, orderForm(customer.id, [printLine(material.id, printer.id, { quantity: 2, unitsPerBatch: 1 })], { confirm: true }));
    await createJobsForOrder(user.id, o.id);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    const line: LineForm = { ...(item.pricingInput as unknown as { form: LineForm }).form, id: item.id, deadline: null };
    // Increasing quantity is fine and updates reservations.
    const revised = await saveOrder(user.id, o.id, orderForm(customer.id, [{ ...line, quantity: 3 }]));
    expect(revised.revision).toBe(2);
    const res = await prisma.materialReservation.findFirstOrThrow({ where: { orderItemId: item.id } });
    expect(res.quantityG.toString()).toBe("150");
    // Going below scheduled units is refused.
    await expect(saveOrder(user.id, o.id, orderForm(customer.id, [{ ...line, quantity: 1 }]))).rejects.toThrow(/cannot go below/);
    // Removing the item is refused.
    await expect(saveOrder(user.id, o.id, orderForm(customer.id, [printLine(material.id, printer.id)]))).rejects.toThrow(/cannot be removed/);
  });

  it("voids a payment and keeps the ledger consistent", async () => {
    const { user, customer, material, printer } = base;
    const o = await saveOrder(user.id, null, orderForm(customer.id, [printLine(material.id, printer.id, { quantity: 1 })], { confirm: true }));
    const p = await recordPayment(user.id, o.id, {
      kind: "PAYMENT",
      method: "CASH",
      amount: "10",
      isDeposit: false,
      receivedAt: null,
      reference: null,
      feeAmount: null,
      notes: null,
      idempotencyKey: null,
    });
    await voidPayment(user.id, p.id, "Entered twice");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).amountPaid.toString()).toBe("0");
    expect(await verifyPaymentCaches()).toEqual([]);
  });

  it("refuses to confirm an order whose pricing is incomplete", async () => {
    const { user, customer, material, printer } = base;
    await prisma.material.update({ where: { id: material.id }, data: { pricePerKg: null } });
    await expect(saveOrder(user.id, null, orderForm(customer.id, [printLine(material.id, printer.id)], { confirm: true }))).rejects.toThrow(/pricing errors/);
    await prisma.material.update({ where: { id: material.id }, data: { pricePerKg: "100" } });
  });
});
