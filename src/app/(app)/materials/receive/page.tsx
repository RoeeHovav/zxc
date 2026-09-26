import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listSuppliers, materialOptions } from "@/server/services/materials";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/misc";
import { firstParam } from "@/lib/utils";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Receive spools" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("inventory");
  const sp = await searchParams;
  const [materials, suppliers, settings] = await Promise.all([materialOptions(), listSuppliers(), getSettings()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Receive spools" description="Record a filament purchase. Creates individual spools, stock movements and (optionally) the expense." back={{ href: "/materials", label: "Materials" }} />
      <ReceiveForm
        materials={materials.map((m) => ({ id: m.id, label: m.label }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        defaultMaterialId={firstParam(sp.materialId) ?? ""}
        vatRegistered={settings.vatMode === "EXCLUSIVE"}
        vatRate={settings.vatRate.toString()}
      />
    </div>
  );
}
