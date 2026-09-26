import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { D } from "@/domain/money";
import { attemptLogin, MAX_FAILURES_PER_ACCOUNT } from "@/server/auth/login";
import { anonymizeCustomer, createCustomer, deleteCustomer, findDuplicates } from "@/server/services/customers";
import { deductFromSpool } from "@/server/services/materials";
import { recordPayment } from "@/server/services/payments";
import { saveOrder } from "@/server/services/orders";
import { acceptQuote, getQuote, reviseQuote, saveQuote, sendQuote } from "@/server/services/quotes";
import { billRevisions, requestRevision, saveDesign, transitionDesign } from "@/server/services/designs";
import type { PaymentForm } from "@/domain/schemas/sales";
import { customerSchema, type CustomerInput } from "@/domain/schemas/customer";
import type { DesignInput } from "@/server/services/designs";
import { addSpool, orderForm, printLine, quoteForm, resetDb, seedBasics } from "./helpers";

let base: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  await resetDb();
  base = await seedBasics();
});

const customerInput = (over: Partial<CustomerInput>): CustomerInput => customerSchema.parse({ name: "X", preferredContact: "PHONE", ...over });
const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const payment = (amount: string, over: Partial<PaymentForm> = {}): PaymentForm => ({
  kind: "PAYMENT",
  method: "CASH",
  amount,
  isDeposit: false,
  receivedAt: null,
  reference: null,
  feeAmount: null,
  notes: null,
  idempotencyKey: null,
  ...over,
});

describe("concurrency", () => {
  it("never deducts the same spool grams twice", async () => {
    const spool = await addSpool(base.material.id, "100");
    const results = await settle(Array.from({ length: 6 }, () => prisma.$transaction((tx) => deductFromSpool(tx, spool.id, new D("30")))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const after = await prisma.spool.findUniqueOrThrow({ where: { id: spool.id } });
    expect(after.remainingG.toString()).toBe("10");
  });

  it("never accepts payments beyond the order total, even when submitted at the same time", async () => {
    const o = await saveOrder(base.user.id, null, orderForm(base.customer.id, [printLine(base.material.id, base.printer.id)], { confirm: true }));
    const half = new D(o.total.toString()).div(2).toFixed(2);
    const results = await settle(Array.from({ length: 5 }, () => recordPayment(base.user.id, o.id, payment(half))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(order.amountPaid.toString()).toBe(o.total.toString());
    const ledger = await prisma.payment.aggregate({ where: { orderId: o.id, voidedAt: null }, _sum: { amount: true } });
    expect(ledger._sum.amount?.toString()).toBe(o.total.toString());
  });

  it("records a double-submitted payment once (idempotency key)", async () => {
    const o = await saveOrder(base.user.id, null, orderForm(base.customer.id, [printLine(base.material.id, base.printer.id)], { confirm: true }));
    const form = payment("10", { idempotencyKey: "dbl-click-1" });
    const results = await settle([recordPayment(base.user.id, o.id, form), recordPayment(base.user.id, o.id, form), recordPayment(base.user.id, o.id, form)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).amountPaid.toString()).toBe("10");
  });

  it("creates one quote for a double-submitted form (idempotency key)", async () => {
    const form = quoteForm(base.customer.id, [printLine(base.material.id, base.printer.id)]);
    const results = await settle([saveQuote(base.user.id, null, form, "quote-key-1"), saveQuote(base.user.id, null, form, "quote-key-1")]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.quote.count({ where: { clientKey: "quote-key-1" } })).toBe(1);
  });
});

describe("login rate limiting", () => {
  it("locks an account after repeated failures, even with the right password", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) expect(await attemptLogin("owner@test.local", `wrong-${i}`, "10.0.0.1")).toEqual({ ok: false, reason: "invalid" });
    expect(await attemptLogin("OWNER@test.local ", "integration-pass-123", "10.0.0.2")).toMatchObject({ ok: false, reason: "rate_limited" });
    await prisma.loginAttempt.deleteMany({});
    expect(await attemptLogin("owner@test.local", "integration-pass-123", "10.0.0.1")).toEqual({ ok: true, userId: base.user.id });
  });

  it("does not let a parallel burst exceed the attempt limit", async () => {
    await prisma.loginAttempt.deleteMany({});
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => attemptLogin("owner@test.local", `burst-${i}`, "10.0.0.3")));
    const checked = results.filter((r) => !r.ok && r.reason === "invalid").length;
    expect(checked).toBeLessThanOrEqual(MAX_FAILURES_PER_ACCOUNT);
    expect(results.some((r) => !r.ok && r.reason === "rate_limited")).toBe(true);
    // Rejected attempts leave no trace, so they cannot extend the lockout window.
    expect(await prisma.loginAttempt.count({ where: { key: "email:owner@test.local" } })).toBe(checked);
    await prisma.loginAttempt.deleteMany({});
  });

  it("gives the same answer for unknown accounts and wrong passwords", async () => {
    expect(await attemptLogin("nobody@test.local", "whatever-123", "10.0.0.4")).toEqual({ ok: false, reason: "invalid" });
    await prisma.loginAttempt.deleteMany({});
  });
});

describe("customer privacy and history guards", () => {
  it("finds duplicates by normalized phone and email", async () => {
    const byPhone = await findDuplicates({ name: "Someone Else", email: null, phone: "+972 50-123-4567" });
    expect(byPhone.map((d) => d.id)).toContain(base.customer.id);
    const byEmail = await findDuplicates({ name: "X", email: " DANA@Example.com ", phone: null });
    expect(byEmail.map((d) => d.id)).toContain(base.customer.id);
  });

  it("refuses to hard-delete a customer with business history, but deletes one without", async () => {
    const withHistory = await createCustomer(base.user.id, customerInput({ name: "Has History", phone: "052-000-0009" }));
    await saveQuote(base.user.id, null, quoteForm(withHistory.id, [printLine(base.material.id, base.printer.id)]));
    await expect(deleteCustomer(base.user.id, withHistory.id)).rejects.toThrow(/Archive or anonymize/);
    const fresh = await createCustomer(base.user.id, customerInput({ name: "Temp Person", phone: "052-000-0000" }));
    await deleteCustomer(base.user.id, fresh.id);
    expect(await prisma.customer.findUnique({ where: { id: fresh.id } })).toBeNull();
  });

  it("anonymizes personal data but keeps financial records", async () => {
    const c = await createCustomer(
      base.user.id,
      customerInput({
        name: "Private Person",
        company: "Acme",
        email: "p@example.com",
        phone: "054-111-2222",
        preferredContact: "EMAIL",
        addressLine1: "1 Herzl St",
        city: "Haifa",
        taxId: "123456789",
        notes: "likes blue",
        tags: "vip",
        marketingConsent: true,
      }),
    );
    const o = await saveOrder(base.user.id, null, orderForm(c.id, [printLine(base.material.id, base.printer.id)], { confirm: true, deliveryMethod: "COURIER", deliveryAddress: "1 Herzl St, Haifa" }));
    await recordPayment(base.user.id, o.id, payment("20"));
    const anon = await anonymizeCustomer(base.user.id, c.id);
    expect(anon).toMatchObject({ company: null, email: null, phone: null, addressLine1: null, city: null, taxId: null, notes: null, tags: [], marketingConsent: false });
    expect(anon.name).toBe(`Anonymized customer ${c.number}`);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(order.deliveryAddress).toBeNull();
    expect(order.total.toString()).toBe(o.total.toString());
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);
  });
});

describe("quote revisions", () => {
  it("creates a draft revision linked to the sent original, which stays on record", async () => {
    const q = await saveQuote(base.user.id, null, quoteForm(base.customer.id, [printLine(base.material.id, base.printer.id)]));
    await sendQuote(base.user.id, q.id);
    const next = await reviseQuote(base.user.id, q.id);
    expect(next).toMatchObject({ status: "DRAFT", revision: q.revision + 1, previousId: q.id, number: q.number });
    expect((await getQuote(q.id))!.status).toBe("REVISED");
    const nextFull = (await getQuote(next.id))!;
    expect(nextFull.items).toHaveLength(1);
    expect(nextFull.total.toString()).toBe(q.total.toString());
    // A revised quote can no longer be accepted.
    await expect(acceptQuote(base.user.id, q.id, null, false)).rejects.toThrow();
  });
});

describe("design revision billing", () => {
  it("charges revisions beyond the allowance and bills them exactly once", async () => {
    const input = {
      customerId: base.customer.id,
      title: "Custom enclosure",
      description: null,
      type: "MODELING",
      complexity: "MODERATE",
      estimatedHours: "3",
      includedRevisions: 1,
      feeMode: "FIXED",
      fixedFee: "300",
      hourlyRate: null,
      additionalRevisionFee: "75",
      ownership: "CUSTOMER",
      licenseNotes: null,
      dueDate: null,
      defaultMaterialId: null,
      defaultPrinterId: null,
      defaultGramsPerUnit: null,
      defaultSupportGrams: null,
      defaultPrintMinutes: null,
    } as DesignInput;
    const d = await saveDesign(base.user.id, null, input);
    const cycle = async (note: string) => {
      await transitionDesign(base.user.id, d.id, "IN_PROGRESS", null);
      await transitionDesign(base.user.id, d.id, "AWAITING_APPROVAL", null);
      return requestRevision(base.user.id, d.id, note);
    };
    await transitionDesign(base.user.id, d.id, "IN_PROGRESS", null);
    await transitionDesign(base.user.id, d.id, "AWAITING_APPROVAL", null);
    const r1 = await requestRevision(base.user.id, d.id, "Move the USB hole");
    const r2 = await cycle("Thicker walls");
    const r3 = await cycle("Add a logo");
    expect([r1.isChargeable, r2.isChargeable, r3.isChargeable]).toEqual([false, true, true]);
    expect(r2.charge?.toString()).toBe("75");

    // Two clicks at once must not bill the same revisions twice.
    const results = await settle([billRevisions(base.user.id, d.id), billRevisions(base.user.id, d.id)]);
    const orders = results.filter((r) => r.status === "fulfilled");
    expect(orders).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: (orders[0] as PromiseFulfilledResult<{ id: string }>).value.id }, include: { items: true } });
    expect(order.itemsNet.toString()).toBe("150");
    expect(order.items[0].serviceType).toBe("MODELING_ONLY");
    await expect(billRevisions(base.user.id, d.id)).rejects.toThrow(/No unbilled chargeable revisions/);
  });
});
