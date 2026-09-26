"use client";
import { ActionForm, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { FormSection } from "@/components/ui/form";
import { enumLabel } from "@/lib/labels";
import { isoDate } from "@/lib/format";
import { saveDesignAction } from "./actions";

export interface DesignValues {
  customerId?: string;
  title?: string;
  description?: string | null;
  type?: string;
  complexity?: string;
  estimatedHours?: string | null;
  includedRevisions?: number;
  feeMode?: string;
  fixedFee?: string | null;
  hourlyRate?: string | null;
  additionalRevisionFee?: string | null;
  ownership?: string;
  licenseNotes?: string | null;
  dueDate?: Date | null;
  defaultMaterialId?: string | null;
  defaultPrinterId?: string | null;
  defaultGramsPerUnit?: string | null;
  defaultSupportGrams?: string | null;
  defaultPrintMinutes?: string | null;
}

export function DesignForm({
  id,
  initial,
  customers,
  materials,
  printers,
  defaultRate,
}: {
  id: string | null;
  initial?: DesignValues;
  customers: { id: string; label: string }[];
  materials: { id: string; label: string }[];
  printers: { id: string; name: string }[];
  defaultRate: string;
}) {
  const v = initial ?? {};
  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm
          action={saveDesignAction.bind(null, id)}
          submitLabel={id ? "Save changes" : "Create project"}
          successMessage={id ? "Saved." : "Design project created."}
          redirectTo={(d: { id: string }) => `/designs/${d.id}`}
          className="gap-6"
        >
          <FormSection title="Project" description="A reusable design: once approved, it can be re-ordered without charging the design fee again.">
            <SelectField
              name="customerId"
              label="Customer"
              required
              defaultValue={v.customerId ?? ""}
              placeholder="Choose customer…"
              options={customers.map((c) => ({ value: c.id, label: c.label }))}
              className="sm:col-span-2"
            />
            <TextField name="title" label="Title" required defaultValue={v.title ?? ""} placeholder="Replacement gear for mixer" className="sm:col-span-2" />
            <SelectField name="type" label="Type" defaultValue={v.type ?? "MODELING"} options={["MODELING", "SCANNING", "SCAN_TO_CAD"].map((t) => ({ value: t, label: enumLabel("designType", t) }))} />
            <SelectField
              name="complexity"
              label="Complexity"
              defaultValue={v.complexity ?? "MODERATE"}
              options={["SIMPLE", "MODERATE", "COMPLEX", "EXPERT"].map((t) => ({ value: t, label: enumLabel("complexity", t) }))}
            />
            <TextareaField name="description" label="Brief / requirements" defaultValue={v.description ?? ""} rows={3} className="sm:col-span-2" />
            <TextField name="dueDate" label="Due date" type="date" defaultValue={isoDate(v.dueDate ?? null)} />
          </FormSection>
          <FormSection title="Fees & revisions" description="Additional revisions beyond the included number are flagged as chargeable.">
            <SelectField
              name="feeMode"
              label="Fee"
              defaultValue={v.feeMode ?? "HOURLY"}
              options={[
                { value: "HOURLY", label: "Hourly" },
                { value: "FIXED", label: "Fixed fee" },
              ]}
            />
            <NumberField name="estimatedHours" label="Estimated hours" suffix="h" defaultValue={v.estimatedHours ?? ""} />
            <NumberField name="hourlyRate" label="Hourly rate" suffix="₪/h" defaultValue={v.hourlyRate ?? defaultRate} />
            <NumberField name="fixedFee" label="Fixed fee" suffix="₪" defaultValue={v.fixedFee ?? ""} />
            <NumberField name="includedRevisions" label="Included revisions" defaultValue={String(v.includedRevisions ?? 2)} />
            <NumberField name="additionalRevisionFee" label="Fee per extra revision" suffix="₪" defaultValue={v.additionalRevisionFee ?? ""} />
          </FormSection>
          <FormSection title="Rights" description="Who owns the design and any license terms.">
            <SelectField
              name="ownership"
              label="Ownership"
              defaultValue={v.ownership ?? "CUSTOMER"}
              options={["CUSTOMER", "BUSINESS", "SHARED"].map((t) => ({ value: t, label: enumLabel("ownership", t) }))}
            />
            <TextareaField name="licenseNotes" label="License / ownership notes" defaultValue={v.licenseNotes ?? ""} rows={2} className="sm:col-span-2" />
          </FormSection>
          <FormSection title="Print defaults" description="Pre-fills re-orders of this design.">
            <SelectField
              name="defaultMaterialId"
              label="Material"
              defaultValue={v.defaultMaterialId ?? ""}
              placeholder="None"
              options={materials.map((m) => ({ value: m.id, label: m.label }))}
              className="sm:col-span-2"
            />
            <SelectField name="defaultPrinterId" label="Printer" defaultValue={v.defaultPrinterId ?? ""} placeholder="None" options={printers.map((p) => ({ value: p.id, label: p.name }))} />
            <NumberField name="defaultGramsPerUnit" label="Grams / unit" suffix="g" defaultValue={v.defaultGramsPerUnit ?? ""} />
            <NumberField name="defaultSupportGrams" label="Support / unit" suffix="g" defaultValue={v.defaultSupportGrams ?? ""} />
            <NumberField name="defaultPrintMinutes" label="Print time / unit" suffix="min" defaultValue={v.defaultPrintMinutes ?? ""} />
          </FormSection>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
