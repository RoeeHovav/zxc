import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/misc";
import { DesignForm } from "../../design-form";
import { designFormData } from "../../form-data";

export const metadata: Metadata = { title: "Edit design project" };

export default async function EditDesignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales");
  const { id } = await params;
  const [d, data] = await Promise.all([prisma.designProject.findUnique({ where: { id } }), designFormData()]);
  if (!d) notFound();
  const s = (v: { toString(): string } | null) => v?.toString() ?? null;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${d.number}`} back={{ href: `/designs/${id}`, label: d.title }} />
      <DesignForm
        id={id}
        {...data}
        initial={{
          ...d,
          estimatedHours: s(d.estimatedHours),
          fixedFee: s(d.fixedFee),
          hourlyRate: s(d.hourlyRate),
          additionalRevisionFee: s(d.additionalRevisionFee),
          defaultGramsPerUnit: s(d.defaultGramsPerUnit),
          defaultSupportGrams: s(d.defaultSupportGrams),
          defaultPrintMinutes: s(d.defaultPrintMinutes),
        }}
      />
    </div>
  );
}
