"use client";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { FormSection } from "@/components/ui/form";
import { enumLabel } from "@/lib/labels";
import { isoDate } from "@/lib/format";
import { savePrinterAction } from "./actions";

export interface PrinterValues {
  name?: string;
  manufacturer?: string | null;
  model?: string;
  serialNumber?: string | null;
  nozzleDiameterMm?: string;
  nozzleNotes?: string | null;
  hasMultiMaterial?: boolean;
  buildVolume?: string | null;
  status?: string;
  purchasePrice?: string | null;
  purchasedAt?: Date | null;
  expectedLifetimeHours?: number | null;
  powerWatts?: number | null;
  maintenancePerHour?: string | null;
  consumablesPerHour?: string | null;
  hourlyRateOverride?: string | null;
  initialPrintHours?: string;
  location?: string | null;
  notes?: string | null;
  materialTypeIds?: string[];
}

export function PrinterForm({ id, initial, materialTypes }: { id: string | null; initial?: PrinterValues; materialTypes: { id: string; code: string }[] }) {
  const v = initial ?? {};
  const selected = new Set(v.materialTypeIds ?? []);
  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm action={savePrinterAction.bind(null, id)} submitLabel={id ? "Save changes" : "Add printer"} successMessage={id ? "Printer saved." : "Printer added."} redirectTo={(d: { id: string }) => `/printers/${d.id}`} className="gap-6">
          <FormSection title="Machine" description="Identify the printer and its setup.">
            <TextField name="name" label="Name" required defaultValue={v.name ?? ""} placeholder="X1C #1" />
            <SelectField name="status" label="Status" defaultValue={v.status ?? "AVAILABLE"} options={["AVAILABLE", "PRINTING", "MAINTENANCE", "OFFLINE", "RETIRED"].map((s) => ({ value: s, label: enumLabel("printerStatus", s) }))} />
            <TextField name="manufacturer" label="Manufacturer" defaultValue={v.manufacturer ?? "Bambu Lab"} />
            <TextField name="model" label="Model" required defaultValue={v.model ?? ""} placeholder="X1 Carbon, P1S, A1…" />
            <TextField name="serialNumber" label="Serial number" defaultValue={v.serialNumber ?? ""} />
            <TextField name="buildVolume" label="Build volume" defaultValue={v.buildVolume ?? ""} placeholder="256 × 256 × 256 mm" />
            <NumberField name="nozzleDiameterMm" label="Nozzle" suffix="mm" defaultValue={v.nozzleDiameterMm ?? "0.4"} />
            <TextField name="nozzleNotes" label="Nozzle notes" defaultValue={v.nozzleNotes ?? ""} placeholder="Hardened steel" />
            <CheckboxField name="hasMultiMaterial" label="Multi-material unit (e.g. AMS)" defaultChecked={v.hasMultiMaterial} className="sm:col-span-2" />
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Supported materials</legend>
              <div className="flex flex-wrap gap-2">
                {materialTypes.map((t) => (
                  <label key={t.id} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="checkbox" name="materialTypeIds" value={t.id} defaultChecked={selected.has(t.id)} className="accent-[var(--primary)]" />
                    {t.code}
                  </label>
                ))}
              </div>
            </fieldset>
          </FormSection>
          <FormSection title="Operating cost" description="Machine cost per hour = purchase ÷ lifetime + power × tariff + maintenance + consumables. Missing values are flagged on quotes, never silently zero.">
            <NumberField name="purchasePrice" label="Purchase price" suffix="₪" defaultValue={v.purchasePrice ?? ""} />
            <NumberField name="expectedLifetimeHours" label="Expected lifetime" suffix="hours" defaultValue={v.expectedLifetimeHours?.toString() ?? ""} placeholder="5000" />
            <NumberField name="powerWatts" label="Average power while printing" suffix="W" defaultValue={v.powerWatts?.toString() ?? ""} placeholder="150" />
            <TextField name="purchasedAt" label="Purchase date" type="date" defaultValue={isoDate(v.purchasedAt ?? null)} />
            <NumberField name="maintenancePerHour" label="Maintenance reserve" suffix="₪/h" defaultValue={v.maintenancePerHour ?? ""} placeholder="0.25" />
            <NumberField name="consumablesPerHour" label="Consumables (nozzles, plates…)" suffix="₪/h" defaultValue={v.consumablesPerHour ?? ""} placeholder="0.15" />
            <NumberField name="hourlyRateOverride" label="Override: fixed machine rate" suffix="₪/h" defaultValue={v.hourlyRateOverride ?? ""} hint="If set, replaces the calculated rate entirely." />
            <NumberField name="initialPrintHours" label="Print hours before tracking" suffix="h" defaultValue={v.initialPrintHours ?? "0"} />
          </FormSection>
          <FormSection title="Other">
            <TextField name="location" label="Location" defaultValue={v.location ?? ""} />
            <TextareaField name="notes" label="Notes" defaultValue={v.notes ?? ""} rows={2} className="sm:col-span-2" />
          </FormSection>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
