"use client";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { FormSection } from "@/components/ui/form";
import { saveMaterialAction } from "./actions";
import { D } from "@/domain/money";

export interface MaterialValues {
  materialTypeId?: string;
  brand?: string;
  productLine?: string | null;
  colorName?: string;
  colorHex?: string | null;
  diameterMm?: string;
  densityGcm3?: string | null;
  pricePerKg?: string | null;
  wastePercent?: string | null;
  defaultSpoolNetG?: number;
  emptySpoolWeightG?: number | null;
  minStockG?: number;
  sku?: string | null;
  supplierId?: string | null;
  storageLocation?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export function MaterialForm({ id, initial, types, suppliers }: { id: string | null; initial?: MaterialValues; types: { id: string; code: string; name: string }[]; suppliers: { id: string; name: string }[] }) {
  const v = initial ?? {};
  const pct = (f: string | null | undefined) => (f ? new D(f).times(100).toString() : "");
  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm action={saveMaterialAction.bind(null, id)} submitLabel={id ? "Save changes" : "Create material"} successMessage={id ? "Material saved." : "Material created."} redirectTo={(d: { id: string }) => `/materials/${d.id}`} className="gap-6">
          <FormSection title="Product" description="What the filament is. Brand + line + color identify it on quotes.">
            <SelectField name="materialTypeId" label="Type" required defaultValue={v.materialTypeId ?? ""} placeholder="Select type…" options={types.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))} />
            <TextField name="brand" label="Brand" required defaultValue={v.brand ?? ""} placeholder="Bambu Lab" />
            <TextField name="productLine" label="Product line" defaultValue={v.productLine ?? ""} placeholder="PLA Basic, Matte, Silk…" />
            <TextField name="colorName" label="Color" required defaultValue={v.colorName ?? ""} placeholder="Jade White" />
            <TextField name="colorHex" label="Color swatch" type="color" defaultValue={v.colorHex ?? "#888888"} className="max-w-32" />
            <NumberField name="diameterMm" label="Diameter" suffix="mm" defaultValue={v.diameterMm ?? "1.75"} />
            <NumberField name="densityGcm3" label="Density" suffix="g/cm³" defaultValue={v.densityGcm3 ?? ""} hint="Optional; used for volume estimates." />
            <TextField name="sku" label="SKU" defaultValue={v.sku ?? ""} />
          </FormSection>
          <FormSection title="Cost" description="Price per kg drives every quote. Leave empty only if unknown — quotes will refuse to price until it is set.">
            <NumberField name="pricePerKg" label="Price per kg (excl. reclaimable VAT)" suffix="₪/kg" defaultValue={v.pricePerKg ?? ""} />
            <NumberField name="wastePercent" label="Waste allowance override" suffix="%" defaultValue={pct(v.wastePercent)} hint="Leave empty to use the global default." />
            <SelectField name="supplierId" label="Preferred supplier" defaultValue={v.supplierId ?? ""} placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </FormSection>
          <FormSection title="Stock" description="Spool weights let you reconcile by weighing; the threshold triggers low-stock alerts.">
            <NumberField name="defaultSpoolNetG" label="Net filament per spool" suffix="g" defaultValue={String(v.defaultSpoolNetG ?? 1000)} />
            <NumberField name="emptySpoolWeightG" label="Empty spool weight" suffix="g" defaultValue={v.emptySpoolWeightG?.toString() ?? ""} hint="Lets you weigh a spool on a kitchen scale." />
            <NumberField name="minStockG" label="Minimum stock" suffix="g" defaultValue={String(v.minStockG ?? 0)} hint="0 disables the alert." />
            <TextField name="storageLocation" label="Storage location" defaultValue={v.storageLocation ?? ""} placeholder="Dry box A" />
            <TextareaField name="notes" label="Notes" defaultValue={v.notes ?? ""} rows={2} className="sm:col-span-2" />
            <CheckboxField name="isActive" label="Active" hint="Inactive materials are hidden from quote pickers." defaultChecked={v.isActive ?? true} className="sm:col-span-2" />
          </FormSection>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
