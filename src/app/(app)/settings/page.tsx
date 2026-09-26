import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { D } from "@/domain/money";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser("settings");
  const s = await getSettings();
  const logo = s.logoFileId ? await prisma.fileAttachment.findUnique({ where: { id: s.logoFileId }, select: { id: true, originalName: true } }) : null;
  const pct = (v: { toString(): string }) => new D(v.toString()).times(100).toString();
  const str = (v: { toString(): string }) => v.toString();
  return (
    <SettingsForm
      logo={logo}
      values={{
        businessName: s.businessName,
        legalName: s.legalName ?? "",
        businessTaxId: s.businessTaxId ?? "",
        addressLine1: s.addressLine1 ?? "",
        addressLine2: s.addressLine2 ?? "",
        city: s.city ?? "",
        postalCode: s.postalCode ?? "",
        country: s.country,
        phone: s.phone ?? "",
        email: s.email ?? "",
        website: s.website ?? "",
        brandColor: s.brandColor,
        vatMode: s.vatMode,
        vatRate: pct(s.vatRate),
        electricityTariffPerKwh: str(s.electricityTariffPerKwh),
        laborCostPerHour: str(s.laborCostPerHour),
        scannerCostPerHour: str(s.scannerCostPerHour),
        defaultMachineCostPerHour: str(s.defaultMachineCostPerHour),
        defaultSetupMinutes: str(s.defaultSetupMinutes),
        materialWastePercent: pct(s.materialWastePercent),
        failureAllowancePercent: pct(s.failureAllowancePercent),
        contingencyPercent: pct(s.contingencyPercent),
        packingCostPerOrder: str(s.packingCostPerOrder),
        transactionFeePercent: pct(s.transactionFeePercent),
        transactionFeeFixed: str(s.transactionFeeFixed),
        modelingRatePerHour: str(s.modelingRatePerHour),
        scanningRatePerHour: str(s.scanningRatePerHour),
        scanCleanupRatePerHour: str(s.scanCleanupRatePerHour),
        reverseEngineeringRatePerHour: str(s.reverseEngineeringRatePerHour),
        quoteValidityDays: String(s.quoteValidityDays),
        defaultDepositPercent: pct(s.defaultDepositPercent),
        requireDepositToProduce: s.requireDepositToProduce,
        defaultPaymentTerms: s.defaultPaymentTerms ?? "",
        quoteTerms: s.quoteTerms ?? "",
        documentFooter: s.documentFooter ?? "",
        maxUploadMb: String(s.maxUploadMb),
        storageQuotaMb: String(s.storageQuotaMb),
      }}
    />
  );
}
