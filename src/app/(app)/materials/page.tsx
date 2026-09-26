import Link from "next/link";
import type { Metadata } from "next";
import { Boxes, PackagePlus, Plus, Settings2 } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listMaterials, listMaterialTypes, type MaterialFilter } from "@/server/services/materials";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterTabs, SearchInput } from "@/components/list-controls";
import { grams, money, spoolWeight } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { TypeFilter } from "./type-filter";

export const metadata: Metadata = { title: "Materials" };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("inventory");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const filter = (firstParam(sp.filter) ?? "active") as MaterialFilter;
  const type = firstParam(sp.type) ?? "";
  const [rows, types] = await Promise.all([listMaterials({ q, filter, type }), listMaterialTypes()]);
  const lowCount = rows.filter((r) => r.stock.lowStock).length;

  return (
    <>
      <PageHeader
        title="Materials"
        description="Filament catalog, spool inventory and reservations."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/materials/catalog">
                <Settings2 /> Types & suppliers
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/materials/receive">
                <PackagePlus /> Receive spools
              </Link>
            </Button>
            <Button asChild>
              <Link href="/materials/new">
                <Plus /> New material
              </Link>
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterTabs
            current={filter}
            options={[
              { value: "active", label: "Active" },
              { value: "low", label: "Low stock" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <TypeFilter types={types.map((t) => t.code)} current={type} />
            <SearchInput placeholder="Brand, color, SKU…" />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={q || type || filter !== "active" ? "No matching materials" : "No materials yet"}
            description={q || type ? "Try a different search or type." : "Add the filaments you stock, with their price per kg, so quotes can be priced accurately."}
            action={
              !q && !type && filter === "active" ? (
                <Button asChild>
                  <Link href="/materials/new">
                    <Plus /> New material
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Material</TH>
                <TH className="text-end">Price / kg</TH>
                <TH className="hidden text-end md:table-cell">On hand</TH>
                <TH className="hidden text-end md:table-cell">Reserved</TH>
                <TH className="text-end">Available</TH>
                <TH className="hidden text-end sm:table-cell">Spools</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((m) => (
                <TR key={m.id} className="relative">
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="size-5 shrink-0 rounded-full border border-border shadow-inner" style={{ background: m.colorHex ?? "transparent" }} aria-hidden />
                      <div className="min-w-0">
                        <Link href={`/materials/${m.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                          {m.brand} {m.productLine} — {m.colorName}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge tone="primary">{m.materialType.code}</Badge>
                          {m.diameterMm.toString() !== "1.75" && <span>{m.diameterMm.toString()} mm</span>}
                          {m.storageLocation && <span>· {m.storageLocation}</span>}
                          {!m.isActive && <Badge tone="muted">Inactive</Badge>}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD className="tabular text-end">{m.pricePerKg ? money(m.pricePerKg) : <Badge tone="danger">Not set</Badge>}</TD>
                  <TD className="tabular hidden text-end md:table-cell">{spoolWeight(m.stock.onHandG, !m.stock.hasEstimates)}</TD>
                  <TD className="tabular hidden text-end text-muted-foreground md:table-cell">{Number(m.stock.reservedG) > 0 ? grams(m.stock.reservedG) : "—"}</TD>
                  <TD className="tabular text-end">
                    <span className={m.stock.lowStock ? "font-semibold text-destructive" : m.stock.nearThreshold ? "font-medium text-warning" : undefined}>
                      {spoolWeight(m.stock.availableG, !m.stock.hasEstimates)}
                    </span>
                    {m.stock.lowStock && <div className="text-[11px] text-destructive">below {grams(m.minStockG)}</div>}
                    {m.stock.nearThreshold && <div className="text-[11px] text-warning">weigh to confirm</div>}
                  </TD>
                  <TD className="tabular hidden text-end sm:table-cell">{m.stock.spoolCount}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {lowCount > 0 && filter !== "low" && (
          <p className="border-t border-border px-5 py-3 text-xs text-destructive">
            {lowCount} material(s) below minimum stock.{" "}
            <Link href="/materials?filter=low" className="font-medium underline">
              Show
            </Link>
          </p>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">≈ marks estimated weights (rounded to 10 g). Weigh spools to replace estimates with measured values.</p>
    </>
  );
}
