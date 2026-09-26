import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { listMaterialTypes, listSuppliers } from "@/server/services/materials";
import { PageHeader } from "@/components/ui/misc";
import { MaterialForm } from "../../material-form";

export const metadata: Metadata = { title: "Edit material" };

export default async function EditMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("inventory");
  const { id } = await params;
  const [m, types, suppliers] = await Promise.all([prisma.material.findUnique({ where: { id } }), listMaterialTypes(), listSuppliers()]);
  if (!m) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${m.brand} ${m.colorName}`} back={{ href: `/materials/${id}`, label: "Material" }} />
      <MaterialForm
        id={id}
        types={types.map((t) => ({ id: t.id, code: t.code, name: t.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        initial={{
          ...m,
          diameterMm: m.diameterMm.toString(),
          densityGcm3: m.densityGcm3?.toString() ?? null,
          pricePerKg: m.pricePerKg?.toString() ?? null,
          wastePercent: m.wastePercent?.toString() ?? null,
        }}
      />
    </div>
  );
}
