import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { listMaterialTypes } from "@/server/services/materials";
import { PageHeader } from "@/components/ui/misc";
import { PrinterForm } from "../../printer-form";

export const metadata: Metadata = { title: "Edit printer" };

export default async function EditPrinterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("production");
  const { id } = await params;
  const [p, types] = await Promise.all([prisma.printer.findUnique({ where: { id }, include: { supportedMaterialTypes: { select: { id: true } } } }), listMaterialTypes()]);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/printers/${id}`, label: p.name }} />
      <PrinterForm
        id={id}
        materialTypes={types.map((t) => ({ id: t.id, code: t.code }))}
        initial={{
          ...p,
          nozzleDiameterMm: p.nozzleDiameterMm.toString(),
          purchasePrice: p.purchasePrice?.toString() ?? null,
          maintenancePerHour: p.maintenancePerHour?.toString() ?? null,
          consumablesPerHour: p.consumablesPerHour?.toString() ?? null,
          hourlyRateOverride: p.hourlyRateOverride?.toString() ?? null,
          initialPrintHours: p.initialPrintHours.toString(),
          materialTypeIds: p.supportedMaterialTypes.map((t) => t.id),
        }}
      />
    </div>
  );
}
