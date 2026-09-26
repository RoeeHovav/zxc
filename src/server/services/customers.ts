import "server-only";
import { prisma } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeEmail, normalizePhone, parseTags, type CustomerInput } from "@/domain/schemas/customer";
import { D, ZERO, dec } from "@/domain/money";
import { NotFoundError, ServiceError, audit, nextNumber } from "./common";
import { deleteStoredFile } from "./files";

export interface DuplicateCandidate {
  id: string;
  number: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  reason: string;
}

export class DuplicateCustomerError extends ServiceError {
  constructor(public candidates: DuplicateCandidate[]) {
    super("A similar customer already exists.");
    this.name = "DuplicateCustomerError";
  }
}

export async function findDuplicates(input: { name: string; email: string | null; phone: string | null }, excludeId?: string): Promise<DuplicateCandidate[]> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const or: Prisma.CustomerWhereInput[] = [{ name: { equals: input.name.trim(), mode: "insensitive" } }];
  if (email) or.push({ emailNormalized: email });
  if (phone) or.push({ phoneNormalized: phone });
  const found = await prisma.customer.findMany({
    where: { OR: or, anonymizedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    take: 5,
    select: { id: true, number: true, name: true, company: true, email: true, phone: true, emailNormalized: true, phoneNormalized: true },
  });
  return found.map((c) => {
    const reasons: string[] = [];
    if (email && c.emailNormalized === email) reasons.push("same email");
    if (phone && c.phoneNormalized === phone) reasons.push("same phone");
    if (c.name.toLowerCase() === input.name.trim().toLowerCase()) reasons.push("same name");
    return { id: c.id, number: c.number, name: c.name, company: c.company, email: c.email, phone: c.phone, reason: reasons.join(", ") };
  });
}

function toData(input: CustomerInput) {
  return {
    name: input.name,
    company: input.company,
    email: input.email,
    emailNormalized: normalizeEmail(input.email),
    phone: input.phone,
    phoneNormalized: normalizePhone(input.phone),
    preferredContact: input.preferredContact,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    postalCode: input.postalCode,
    country: input.country,
    taxId: input.taxId,
    vatExempt: input.vatExempt,
    notes: input.notes,
    tags: parseTags(input.tags),
    pricingPolicyId: input.pricingPolicyId,
    marketingConsent: input.marketingConsent,
  };
}

export async function createCustomer(userId: string, input: CustomerInput) {
  if (!input.allowDuplicate) {
    const dups = await findDuplicates(input);
    if (dups.length) throw new DuplicateCustomerError(dups);
  }
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "CUSTOMER");
    const customer = await tx.customer.create({ data: { number, ...toData(input) } });
    await audit(tx, { userId, entityType: "CUSTOMER", entityId: customer.id, action: "CREATE", summary: `Created customer ${number} ${customer.name}` });
    return customer;
  });
}

export async function updateCustomer(userId: string, id: string, input: CustomerInput) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Customer");
  if (existing.anonymizedAt) throw new ServiceError("This customer was anonymized and can no longer be edited.");
  if (!input.allowDuplicate) {
    const dups = await findDuplicates(input, id);
    const relevant = dups.filter((d) => d.reason.includes("email") || d.reason.includes("phone"));
    if (relevant.length) throw new DuplicateCustomerError(relevant);
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data: toData(input) });
    await audit(tx, { userId, entityType: "CUSTOMER", entityId: id, action: "UPDATE", summary: `Updated customer ${c.number}` });
    return c;
  });
}

export async function setArchived(userId: string, id: string, archived: boolean) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await audit(tx, { userId, entityType: "CUSTOMER", entityId: id, action: archived ? "ARCHIVE" : "UNARCHIVE", summary: `${archived ? "Archived" : "Restored"} customer ${c.number}` });
    return c;
  });
}

export async function linkedRecordCounts(id: string) {
  const [quotes, orders, payments, designs] = await Promise.all([
    prisma.quote.count({ where: { customerId: id } }),
    prisma.order.count({ where: { customerId: id } }),
    prisma.payment.count({ where: { customerId: id } }),
    prisma.designProject.count({ where: { customerId: id } }),
  ]);
  return { quotes, orders, payments, designs, total: quotes + orders + payments + designs };
}

/** Hard delete is only allowed for customers without any business history. */
export async function deleteCustomer(userId: string, id: string) {
  const counts = await linkedRecordCounts(id);
  if (counts.total > 0)
    throw new ServiceError(
      `This customer has ${counts.quotes} quote(s), ${counts.orders} order(s), ${counts.payments} payment(s) and ${counts.designs} design(s). Archive or anonymize instead so records are not lost.`,
    );
  const files = await prisma.fileAttachment.findMany({ where: { customerId: id } });
  await prisma.$transaction(async (tx) => {
    const c = await tx.customer.delete({ where: { id } });
    await tx.fileAttachment.deleteMany({ where: { customerId: id } });
    await audit(tx, { userId, entityType: "CUSTOMER", entityId: id, action: "DELETE", summary: `Deleted customer ${c.number} (no linked records)` });
  });
  await Promise.all(files.map((f) => deleteStoredFile(f.storageKey)));
}

/**
 * Privacy erasure that keeps accounting records: personal fields are wiped, documents keep
 * amounts and numbers. Files attached directly to the customer are deleted.
 */
export async function anonymizeCustomer(userId: string, id: string) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Customer");
  if (c.anonymizedAt) return c;
  const files = await prisma.fileAttachment.findMany({ where: { customerId: id } });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({
      where: { id },
      data: {
        name: `Anonymized customer ${c.number}`,
        company: null,
        email: null,
        emailNormalized: null,
        phone: null,
        phoneNormalized: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        postalCode: null,
        taxId: null,
        notes: null,
        tags: [],
        marketingConsent: false,
        anonymizedAt: new Date(),
        archivedAt: c.archivedAt ?? new Date(),
      },
    });
    await tx.order.updateMany({ where: { customerId: id }, data: { deliveryAddress: null } });
    await tx.fileAttachment.deleteMany({ where: { customerId: id } });
    await audit(tx, { userId, entityType: "CUSTOMER", entityId: id, action: "ANONYMIZE", summary: `Anonymized customer ${c.number}; financial records retained` });
    return updated;
  });
  await Promise.all(files.map((f) => deleteStoredFile(f.storageKey)));
  return result;
}

export type CustomerFilter = "active" | "archived" | "all" | "balance";

export async function listCustomers(opts: { q?: string; filter?: CustomerFilter; page?: number; pageSize?: number }) {
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.CustomerWhereInput = {};
  if (opts.filter === "archived") where.archivedAt = { not: null };
  else if (opts.filter !== "all") where.archivedAt = null;
  const q = opts.q?.trim();
  if (q) {
    const phone = normalizePhone(q);
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { tags: { has: q.toLowerCase() } },
      ...(phone ? [{ phoneNormalized: { contains: phone } }] : []),
    ];
  }
  const customers = await prisma.customer.findMany({
    where,
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    select: {
      id: true,
      number: true,
      name: true,
      company: true,
      email: true,
      phone: true,
      city: true,
      preferredContact: true,
      tags: true,
      archivedAt: true,
      createdAt: true,
      _count: { select: { orders: true, quotes: true } },
    },
  });
  const balances = await customerBalances(customers.map((c) => c.id));
  let rows = customers.map((c) => ({ ...c, balance: balances.get(c.id) ?? "0.00" }));
  if (opts.filter === "balance") rows = rows.filter((r) => dec(r.balance).gt(0));
  const total = rows.length;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

/** Outstanding balance per customer: Σ (order total − paid) for live orders, minus paid on canceled orders. */
export async function customerBalances(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const orders = await prisma.order.findMany({
    where: { customerId: { in: ids }, status: { not: "DRAFT" } },
    select: { customerId: true, status: true, total: true, amountPaid: true },
  });
  const acc = new Map<string, InstanceType<typeof D>>();
  for (const o of orders) {
    const due = o.status === "CANCELED" ? dec(o.amountPaid.toString()).neg() : dec(o.total.toString()).minus(dec(o.amountPaid.toString()));
    acc.set(o.customerId, (acc.get(o.customerId) ?? ZERO).plus(due));
  }
  for (const [k, v] of acc) map.set(k, v.toFixed(2));
  return map;
}

export async function getCustomerDetail(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      pricingPolicy: { select: { id: true, name: true } },
      quotes: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, revision: true, status: true, total: true, issueDate: true, validUntil: true, title: true } },
      orders: { orderBy: { orderDate: "desc" }, select: { id: true, number: true, status: true, total: true, amountPaid: true, orderDate: true, dueDate: true, title: true } },
      payments: {
        orderBy: { receivedAt: "desc" },
        select: { id: true, number: true, kind: true, method: true, amount: true, receivedAt: true, voidedAt: true, order: { select: { id: true, number: true } } },
      },
      designs: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true, status: true, type: true } },
      files: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) return null;
  const balance = (await customerBalances([id])).get(id) ?? "0.00";
  const paid = customer.payments.filter((p) => !p.voidedAt).reduce((acc, p) => (p.kind === "REFUND" ? acc.minus(dec(p.amount.toString())) : acc.plus(dec(p.amount.toString()))), ZERO);
  const lifetime = customer.orders.filter((o) => !["DRAFT", "CANCELED"].includes(o.status)).reduce((acc, o) => acc.plus(dec(o.total.toString())), ZERO);
  return { customer, balance, totalPaid: paid.toFixed(2), lifetimeValue: lifetime.toFixed(2) };
}

/** Machine- and human-readable export of everything stored about one customer. */
export async function exportCustomerData(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      quotes: { include: { items: true } },
      orders: { include: { items: true, payments: true } },
      payments: true,
      designs: { include: { timeEntries: true, revisions: true } },
      files: { select: { id: true, originalName: true, sizeBytes: true, createdAt: true, purpose: true } },
    },
  });
  if (!customer) throw new NotFoundError("Customer");
  return { exportedAt: new Date().toISOString(), notice: "Personal data export generated by PrintForge.", customer };
}

export async function customerOptions(q?: string) {
  return prisma.customer.findMany({
    where: {
      archivedAt: null,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, number: true, name: true, company: true, vatExempt: true, pricingPolicyId: true, addressLine1: true, city: true },
  });
}
