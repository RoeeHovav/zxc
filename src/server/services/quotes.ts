import "server-only";
import { prisma, type Tx } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { checkQuoteTransition, type QuoteStatus } from "@/domain/status/other";
import type { QuoteForm } from "@/domain/schemas/sales";
import { NotFoundError, ServiceError, audit, idempotent, nextNumber } from "./common";
import { lineColumns, type StoredLineInput } from "./pricing-inputs";
import { priceDocument, totalsColumns } from "./documents";
export { priceDocument, totalsColumns };
import { getSettings } from "./settings";
import { createOrderFromQuote } from "./orders";

/** Replaces a document's items: updates kept ids, creates new, deletes removed. */
async function syncItems<T extends { id: string }>(
  existing: T[],
  lines: QuoteForm["lines"],
  build: (line: QuoteForm["lines"][number], idx: number) => Record<string, unknown>,
  ops: { update: (id: string, data: Record<string, unknown>) => Promise<unknown>; create: (data: Record<string, unknown>) => Promise<unknown>; deleteMany: (ids: string[]) => Promise<unknown> },
) {
  const keep = new Set(lines.map((l) => l.id).filter(Boolean) as string[]);
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length) await ops.deleteMany(removed);
  const existingIds = new Set(existing.map((e) => e.id));
  for (let i = 0; i < lines.length; i++) {
    const data = build(lines[i], i);
    if (lines[i].id && existingIds.has(lines[i].id!)) await ops.update(lines[i].id!, data);
    else await ops.create(data);
  }
}

export async function saveQuote(userId: string, id: string | null, form: QuoteForm, clientKey?: string | null) {
  const save = () => saveQuoteTx(userId, id, form, clientKey);
  return id ? save() : idempotent(clientKey, (key) => prisma.quote.findUnique({ where: { clientKey: key } }), save);
}

async function saveQuoteTx(userId: string, id: string | null, form: QuoteForm, clientKey?: string | null) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: form.customerId } });
    if (!customer) throw new ServiceError("Select a customer.");
    if (customer.anonymizedAt) throw new ServiceError("This customer was anonymized and cannot receive new quotes.");
    const existing = id ? await tx.quote.findUnique({ where: { id }, include: { items: true } }) : null;
    if (id && !existing) throw new NotFoundError("Quote");
    if (existing && existing.status !== "DRAFT") throw new ServiceError("Only draft quotes can be edited. Create a revision instead.");
    if (!existing && customer.archivedAt) throw new ServiceError("This customer is archived. Restore them first.");

    const { ctx, stored, result } = await priceDocument(tx, form, customer.vatExempt, existing);
    const settings = await getSettings(tx);
    const validUntil = form.validUntil ?? existing?.validUntil ?? new Date(Date.now() + settings.quoteValidityDays * 86400000);
    const header = {
      customerId: customer.id,
      title: form.title,
      validUntil,
      requestedBy: form.requestedBy,
      pricingPolicyId: ctx.policy.id,
      currency: ctx.currency,
      pricingContext: JSON.parse(JSON.stringify(ctx)),
      orderDiscountType: form.orderDiscountType,
      orderDiscountValue: form.orderDiscountValue,
      shippingMethod: form.shippingMethod,
      shippingCharge: form.shippingCharge ?? "0",
      shippingCost: form.shippingCost ?? "0",
      depositPercent: form.depositPercent,
      paymentTerms: form.paymentTerms ?? (existing ? null : settings.defaultPaymentTerms),
      customerNotes: form.customerNotes,
      internalNotes: form.internalNotes,
      ...totalsColumns(result),
    };
    let quote;
    if (existing) {
      quote = await tx.quote.update({ where: { id: existing.id }, data: header });
      await syncItems(existing.items, form.lines, (l, i) => lineColumns(l, i, stored[i], result.lines[i]), {
        update: (itemId, data) => tx.quoteItem.update({ where: { id: itemId }, data: data as Prisma.QuoteItemUncheckedUpdateInput }),
        create: (data) => tx.quoteItem.create({ data: { ...(data as Prisma.QuoteItemUncheckedCreateInput), quoteId: existing.id } }),
        deleteMany: (ids) => tx.quoteItem.deleteMany({ where: { id: { in: ids }, quoteId: existing.id } }),
      });
      await audit(tx, {
        userId,
        entityType: "QUOTE",
        entityId: quote.id,
        action: "UPDATE",
        summary: `Updated ${quote.number} (total ${quote.total})${form.refreshRates ? " — re-priced with current rates" : ""}`,
      });
    } else {
      const number = await nextNumber(tx, "QUOTE");
      quote = await tx.quote.create({ data: { ...header, number, clientKey: clientKey ?? null } });
      for (let i = 0; i < form.lines.length; i++) await tx.quoteItem.create({ data: { ...lineColumns(form.lines[i], i, stored[i], result.lines[i]), quoteId: quote.id } });
      await audit(tx, { userId, entityType: "QUOTE", entityId: quote.id, action: "CREATE", summary: `Created quote ${number} for ${customer.name}` });
    }
    return quote;
  });
}

/** Marks SENT quotes whose validity date passed as EXPIRED (idempotent). */
export async function expireQuotes(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  await prisma.quote.updateMany({ where: { status: "SENT", validUntil: { lt: start } }, data: { status: "EXPIRED" } });
}

export async function listQuotes(opts: { q?: string; status?: string; page?: number; pageSize?: number }) {
  await expireQuotes();
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.QuoteWhereInput = {};
  if (opts.status === "open") where.status = { in: ["DRAFT", "SENT"] };
  else if (opts.status && opts.status !== "all") where.status = opts.status as QuoteStatus;
  else if (!opts.status) where.status = { not: "REVISED" };
  const q = opts.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ number: ci }, { title: ci }, { customer: { name: ci } }, { customer: { company: ci } }, { items: { some: { partName: ci } } }];
  }
  const [rows, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { id: true, name: true, company: true } }, _count: { select: { items: true } }, order: { select: { id: true, number: true } } },
    }),
    prisma.quote.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getQuote(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      items: {
        orderBy: { position: "asc" },
        include: { material: { select: { id: true, colorHex: true } }, printer: { select: { id: true, name: true } }, designProject: { select: { id: true, number: true, title: true } }, files: true },
      },
      previous: { select: { id: true, number: true, revision: true, status: true } },
      next: { select: { id: true, number: true, revision: true, status: true } },
      order: { select: { id: true, number: true, status: true } },
      files: { orderBy: { createdAt: "desc" } },
      pricingPolicy: { select: { name: true } },
    },
  });
}

async function loadForTransition(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE`;
  const q = await tx.quote.findUnique({ where: { id }, include: { _count: { select: { items: true } }, order: { select: { id: true } } } });
  if (!q) throw new NotFoundError("Quote");
  return q;
}

function assertTransition(q: Awaited<ReturnType<typeof loadForTransition>>, to: QuoteStatus) {
  const errors = checkQuoteTransition({ status: q.status, itemCount: q._count.items, pricingComplete: q.pricingComplete, validUntil: q.validUntil, hasOrder: !!q.order }, to);
  if (errors.length) throw new ServiceError(errors.join(" "));
}

export async function sendQuote(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    if (q.status === "SENT") return q;
    assertTransition(q, "SENT");
    const updated = await tx.quote.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), issueDate: new Date() } });
    await audit(tx, { userId, entityType: "QUOTE", entityId: id, action: "SEND", summary: `Marked ${q.number} as sent` });
    return updated;
  });
}

export async function acceptQuote(userId: string, id: string, approvalNote: string | null, createOrder: boolean) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    assertTransition(q, "ACCEPTED");
    await tx.quote.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: new Date(), approvalNote } });
    await audit(tx, { userId, entityType: "QUOTE", entityId: id, action: "ACCEPT", summary: `Customer accepted ${q.number}${approvalNote ? `: ${approvalNote}` : ""}` });
    if (!createOrder) return { orderId: null as string | null };
    const order = await createOrderFromQuote(tx, userId, id);
    return { orderId: order.id };
  });
}

export async function convertAcceptedQuote(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    if (q.status !== "ACCEPTED") throw new ServiceError("Only accepted quotes can be converted.");
    if (q.order) return { orderId: q.order.id };
    const order = await createOrderFromQuote(tx, userId, id);
    return { orderId: order.id };
  });
}

export async function rejectQuote(userId: string, id: string, reason: string | null) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    assertTransition(q, "REJECTED");
    await tx.quote.update({ where: { id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason } });
    await audit(tx, { userId, entityType: "QUOTE", entityId: id, action: "REJECT", summary: `${q.number} rejected${reason ? `: ${reason}` : ""}` });
  });
}

/** Creates the next revision as a draft copy (same snapshot) and marks the current one REVISED. */
export async function reviseQuote(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    assertTransition(q, "REVISED");
    const full = await tx.quote.findUniqueOrThrow({ where: { id }, include: { items: true } });
    await tx.quote.update({ where: { id }, data: { status: "REVISED" } });
    const settings = await getSettings(tx);
    const {
      id: _id,
      items,
      createdAt: _c,
      updatedAt: _u,
      status: _s,
      sentAt: _se,
      acceptedAt: _a,
      rejectedAt: _r,
      rejectionReason: _rr,
      approvalNote: _ap,
      clientKey: _ck,
      previousId: _p,
      ...rest
    } = full;
    void _id;
    void _c;
    void _u;
    void _s;
    void _se;
    void _a;
    void _r;
    void _rr;
    void _ap;
    void _ck;
    void _p;
    const next = await tx.quote.create({
      data: {
        ...(rest as Omit<typeof rest, "pricingContext" | "pricingSummary">),
        pricingContext: full.pricingContext as Prisma.InputJsonValue,
        pricingSummary: (full.pricingSummary ?? undefined) as Prisma.InputJsonValue | undefined,
        revision: full.revision + 1,
        status: "DRAFT",
        issueDate: new Date(),
        validUntil: new Date(Date.now() + settings.quoteValidityDays * 86400000),
        previousId: id,
      },
    });
    for (const it of items) {
      const { id: _iid, quoteId: _q, ...itemRest } = it;
      void _iid;
      void _q;
      await tx.quoteItem.create({
        data: { ...itemRest, quoteId: next.id, pricingInput: it.pricingInput as Prisma.InputJsonValue, pricingResult: (it.pricingResult ?? undefined) as Prisma.InputJsonValue | undefined },
      });
    }
    await audit(tx, { userId, entityType: "QUOTE", entityId: next.id, action: "REVISE", summary: `Created revision ${next.revision} of ${q.number}` });
    return next;
  });
}

export async function deleteDraftQuote(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const q = await loadForTransition(tx, id);
    if (q.status !== "DRAFT") throw new ServiceError("Only drafts can be deleted. Sent quotes are kept as records.");
    await tx.quote.delete({ where: { id } });
    if (q.previousId) await tx.quote.update({ where: { id: q.previousId }, data: { status: "SENT" } });
    await audit(tx, { userId, entityType: "QUOTE", entityId: id, action: "DELETE", summary: `Deleted draft ${q.number} rev ${q.revision}` });
  });
}

/** Editor state for reopening a document: the stored form fields of each line. */
export function linesForEditor(items: { id: string; pricingInput: unknown }[]) {
  return items.map((it) => {
    const stored = it.pricingInput as StoredLineInput;
    return { ...stored.form, id: it.id, resolved: { material: stored.print?.material ?? null, supportMaterial: stored.print?.supportMaterial ?? null, printer: stored.print?.printer ?? null } };
  });
}
