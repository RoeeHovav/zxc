import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listMaterialTypes } from "@/server/services/materials";
import { PageHeader } from "@/components/ui/misc";
import { PrinterForm } from "../printer-form";

export const metadata: Metadata = { title: "Add printer" };

export default async function NewPrinterPage() {
  await requireUser("production");
  const types = await listMaterialTypes();
  const common = new Set(["PLA", "PETG", "ABS", "ASA", "TPU"]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add printer" back={{ href: "/printers", label: "Printers" }} />
      <PrinterForm id={null} materialTypes={types.map((t) => ({ id: t.id, code: t.code }))} initial={{ materialTypeIds: types.filter((t) => common.has(t.code)).map((t) => t.id) }} />
    </div>
  );
}
