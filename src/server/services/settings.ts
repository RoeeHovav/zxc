import "server-only";
import { prisma, type Tx } from "../db";
import type { PricingPolicy, Prisma, Settings } from "@/generated/prisma/client";
import type { PricingContext } from "@/domain/pricing/types";
import { ServiceError, audit } from "./common";

export async function getSettings(tx: Tx | typeof prisma = prisma): Promise<Settings> {
  return tx.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function listPolicies(includeArchived = false) {
  return prisma.pricingPolicy.findMany({ where: includeArchived ? {} : { isArchived: false }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

/** Returns the default policy, creating a sensible "Standard" policy on first use. */
export async function getDefaultPolicy(tx: Tx | typeof prisma = prisma): Promise<PricingPolicy> {
  const found = await tx.pricingPolicy.findFirst({ where: { isDefault: true, isArchived: false } });
  if (found) return found;
  const any = await tx.pricingPolicy.findFirst({ where: { isArchived: false }, orderBy: { createdAt: "asc" } });
  if (any) return tx.pricingPolicy.update({ where: { id: any.id }, data: { isDefault: true } });
  return tx.pricingPolicy.create({
    data: { name: "Standard", description: "Default retail pricing", method: "MARKUP", markupPercent: 1, minimumOrderCharge: 30, minimumMarginPercent: 0.3, priceRoundingStep: 1, isDefault: true },
  });
}

export async function resolvePolicy(tx: Tx | typeof prisma, policyId: string | null | undefined): Promise<PricingPolicy> {
  if (policyId) {
    const p = await tx.pricingPolicy.findUnique({ where: { id: policyId } });
    if (!p) throw new ServiceError("The selected pricing policy no longer exists.");
    return p;
  }
  return getDefaultPolicy(tx);
}

/** Captures every rate that influences a price into an immutable snapshot. */
export function buildPricingContext(settings: Settings, policy: PricingPolicy, now = new Date()): PricingContext {
  const str = (v: { toString(): string }) => v.toString();
  return {
    version: 1,
    capturedAt: now.toISOString(),
    currency: settings.currency,
    vatMode: settings.vatMode,
    vatRate: str(settings.vatRate),
    rates: {
      electricityTariffPerKwh: str(settings.electricityTariffPerKwh),
      laborCostPerHour: str(settings.laborCostPerHour),
      scannerCostPerHour: str(settings.scannerCostPerHour),
      defaultMachineCostPerHour: str(settings.defaultMachineCostPerHour),
      defaultSetupMinutes: str(settings.defaultSetupMinutes),
      materialWastePercent: str(settings.materialWastePercent),
      failureAllowancePercent: str(settings.failureAllowancePercent),
      contingencyPercent: str(settings.contingencyPercent),
      packingCostPerOrder: str(settings.packingCostPerOrder),
      transactionFeePercent: str(settings.transactionFeePercent),
      transactionFeeFixed: str(settings.transactionFeeFixed),
      modelingRatePerHour: str(settings.modelingRatePerHour),
      scanningRatePerHour: str(settings.scanningRatePerHour),
      scanCleanupRatePerHour: str(settings.scanCleanupRatePerHour),
      reverseEngineeringRatePerHour: str(settings.reverseEngineeringRatePerHour),
    },
    policy: {
      id: policy.id,
      name: policy.name,
      method: policy.method,
      markupPercent: str(policy.markupPercent),
      marginPercent: str(policy.marginPercent),
      minimumOrderCharge: str(policy.minimumOrderCharge),
      minimumMarginPercent: str(policy.minimumMarginPercent),
      priceRoundingStep: str(policy.priceRoundingStep),
      roundingMode: policy.roundingMode,
    },
    defaultDepositPercent: str(settings.defaultDepositPercent),
  };
}

export async function currentPricingContext(policyId?: string | null, tx: Tx | typeof prisma = prisma) {
  const settings = await getSettings(tx);
  const policy = await resolvePolicy(tx, policyId);
  return buildPricingContext(settings, policy);
}

export async function updateSettings(userId: string, data: Omit<Prisma.SettingsUpdateInput, "isDemo" | "id">) {
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const after = await tx.settings.update({ where: { id: 1 }, data });
    const changed = Object.keys(data).filter((k) => String((before as Record<string, unknown>)[k]) !== String((after as Record<string, unknown>)[k]));
    if (changed.length)
      await audit(tx, { userId, entityType: "SETTINGS", entityId: "1", action: "UPDATE", summary: `Updated settings: ${changed.join(", ")}`, details: { changed } });
    return after;
  });
}

export interface PolicyInput {
  name: string;
  description: string | null;
  method: "MARKUP" | "MARGIN";
  markupPercent: string | null;
  marginPercent: string | null;
  minimumOrderCharge: string | null;
  minimumMarginPercent: string | null;
  priceRoundingStep: string | null;
  roundingMode: "UP" | "NEAREST";
  isDefault: boolean;
}

export async function savePolicy(userId: string, id: string | null, i: PolicyInput) {
  const data = {
    name: i.name,
    description: i.description,
    method: i.method,
    markupPercent: i.markupPercent ?? "1",
    marginPercent: i.marginPercent ?? "0.5",
    minimumOrderCharge: i.minimumOrderCharge ?? "0",
    minimumMarginPercent: i.minimumMarginPercent ?? "0",
    priceRoundingStep: i.priceRoundingStep ?? "0",
    roundingMode: i.roundingMode,
  };
  return prisma.$transaction(async (tx) => {
    const p = id ? await tx.pricingPolicy.update({ where: { id }, data }) : await tx.pricingPolicy.create({ data });
    if (i.isDefault) {
      await tx.pricingPolicy.updateMany({ where: { NOT: { id: p.id } }, data: { isDefault: false } });
      await tx.pricingPolicy.update({ where: { id: p.id }, data: { isDefault: true, isArchived: false } });
    }
    await audit(tx, { userId, entityType: "POLICY", entityId: p.id, action: id ? "UPDATE" : "CREATE", summary: `${id ? "Updated" : "Created"} pricing policy ${p.name} (existing quotes keep their snapshot)` });
    return p;
  });
}

export async function archivePolicy(userId: string, id: string, archived: boolean) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.pricingPolicy.findUniqueOrThrow({ where: { id } });
    if (archived && p.isDefault) throw new ServiceError("Choose another default policy before archiving this one.");
    await tx.pricingPolicy.update({ where: { id }, data: { isArchived: archived } });
    await audit(tx, { userId, entityType: "POLICY", entityId: id, action: archived ? "ARCHIVE" : "RESTORE", summary: `${archived ? "Archived" : "Restored"} pricing policy ${p.name}` });
  });
}
