import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listMaterialTypes, listSuppliers } from "@/server/services/materials";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, PageHeader } from "@/components/ui/misc";
import { CatalogForms } from "./catalog-forms";

export const metadata: Metadata = { title: "Material types & suppliers" };

export default async function CatalogPage() {
  await requireUser("inventory");
  const [types, suppliers] = await Promise.all([listMaterialTypes(), listSuppliers()]);
  return (
    <>
      <PageHeader title="Types & suppliers" description="Extend the material families you print with and the suppliers you buy from." back={{ href: "/materials", label: "Materials" }} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Material types" description="PLA, PETG, ABS and ASA are built in; add any custom family." actions={<CatalogForms kind="type" />} />
          <ul className="divide-y divide-border">
            {types.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <Badge tone="primary" className="me-2">
                      {t.code}
                    </Badge>
                    {t.name}
                  </p>
                  {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {t.defaultDensity ? `${t.defaultDensity.toString()} g/cm³ · ` : ""}
                  {t._count.materials} material(s)
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Suppliers" actions={<CatalogForms kind="supplier" />} />
          {suppliers.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">No suppliers yet.</p>
            </CardContent>
          ) : (
            <ul className="divide-y divide-border">
              {suppliers.map((s) => (
                <li key={s.id} className="px-5 py-3">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{[s.contactName, s.phone, s.email, s.website].filter(Boolean).join(" · ") || "No contact details"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
