import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listMaterialTypes, listSuppliers } from "@/server/services/materials";
import { PageHeader } from "@/components/ui/misc";
import { MaterialForm } from "../material-form";

export const metadata: Metadata = { title: "New material" };

export default async function NewMaterialPage() {
  await requireUser("inventory");
  const [types, suppliers] = await Promise.all([listMaterialTypes(), listSuppliers()]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New material" back={{ href: "/materials", label: "Materials" }} />
      <MaterialForm id={null} types={types.map((t) => ({ id: t.id, code: t.code, name: t.name }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
