"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { FormSection } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { saveSettingsAction, setLogoAction } from "./actions";

type V = Record<string, string | boolean>;

function LogoPicker({ logo }: { logo: { id: string; originalName: string } | null }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", "LOGO");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const r = await setLogoAction(j.id);
      if (!r.ok) throw new Error(r.error);
      toast.success("Logo updated.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
      <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={`/api/files/${logo.id}`} alt="Business logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-6 text-muted-foreground" />}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {logo ? "Replace logo" : "Upload logo"}
        </Button>
        {logo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              const r = await setLogoAction(null);
              if (r.ok) router.refresh();
            }}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG or JPEG, shown on quotes and documents.</p>
      <input ref={input} type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </div>
  );
}

export function SettingsForm({ values: v, logo }: { values: V; logo: { id: string; originalName: string } | null }) {
  const s = (k: string) => String(v[k] ?? "");
  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm action={saveSettingsAction} submitLabel="Save settings" className="gap-8">
          <FormSection title="Business profile" description="Printed on quotes, confirmations, delivery notes and payment acknowledgements.">
            <LogoPicker logo={logo} />
            <TextField name="businessName" label="Business name" required defaultValue={s("businessName")} />
            <TextField name="legalName" label="Legal name" defaultValue={s("legalName")} />
            <TextField name="businessTaxId" label="Business ID (ע.מ. / ח.פ.)" defaultValue={s("businessTaxId")} />
            <TextField name="brandColor" label="Brand color" type="color" defaultValue={s("brandColor")} className="max-w-32" />
            <TextField name="addressLine1" label="Address" defaultValue={s("addressLine1")} className="sm:col-span-2" />
            <TextField name="addressLine2" label="Address line 2" defaultValue={s("addressLine2")} />
            <TextField name="city" label="City" defaultValue={s("city")} />
            <TextField name="postalCode" label="Postal code" defaultValue={s("postalCode")} />
            <TextField name="country" label="Country" defaultValue={s("country")} />
            <TextField name="phone" label="Phone" defaultValue={s("phone")} />
            <TextField name="email" label="Email" type="email" defaultValue={s("email")} />
            <TextField name="website" label="Website" defaultValue={s("website")} className="sm:col-span-2" />
          </FormSection>

          <FormSection title="Tax" description="Osek Murshe / companies add VAT on top of net prices. Osek Patur (exempt dealer) charges no VAT.">
            <SelectField name="vatMode" label="VAT mode" defaultValue={s("vatMode")} options={[{ value: "EXCLUSIVE", label: "VAT-registered — add VAT" }, { value: "EXEMPT", label: "Exempt dealer — no VAT" }]} />
            <NumberField name="vatRate" label="VAT rate" suffix="%" defaultValue={s("vatRate")} hint="Israel's standard rate is 18% (since Jan 2025). Verify with your accountant." />
          </FormSection>

          <FormSection title="Production costs" description="Internal costs used to estimate what a job costs you. Printer-specific costs are set on each printer.">
            <NumberField name="electricityTariffPerKwh" label="Electricity tariff" suffix="₪/kWh" defaultValue={s("electricityTariffPerKwh")} />
            <NumberField name="laborCostPerHour" label="Your labor cost" suffix="₪/h" defaultValue={s("laborCostPerHour")} hint="What an hour of your time costs the business." />
            <NumberField name="defaultMachineCostPerHour" label="Fallback machine cost" suffix="₪/h" defaultValue={s("defaultMachineCostPerHour")} hint="Used (with a warning) when no printer data is available." />
            <NumberField name="defaultSetupMinutes" label="Setup per plate" suffix="min" defaultValue={s("defaultSetupMinutes")} />
            <NumberField name="materialWastePercent" label="Material waste" suffix="%" defaultValue={s("materialWastePercent")} hint="Skirts, brims, stringing." />
            <NumberField name="failureAllowancePercent" label="Failure allowance" suffix="%" defaultValue={s("failureAllowancePercent")} hint="Expected reprints, on material + machine." />
            <NumberField name="contingencyPercent" label="Contingency" suffix="%" defaultValue={s("contingencyPercent")} />
            <NumberField name="packingCostPerOrder" label="Packing per order" suffix="₪" defaultValue={s("packingCostPerOrder")} />
            <NumberField name="transactionFeePercent" label="Payment fee" suffix="%" defaultValue={s("transactionFeePercent")} hint="Estimated card/processor fee." />
            <NumberField name="transactionFeeFixed" label="Payment fee (fixed)" suffix="₪" defaultValue={s("transactionFeeFixed")} />
            <NumberField name="scannerCostPerHour" label="Scanner cost" suffix="₪/h" defaultValue={s("scannerCostPerHour")} />
          </FormSection>

          <FormSection title="Service rates" description="Customer prices per hour for design work. These are billed as-is (no markup) and never multiplied by print quantity.">
            <NumberField name="modelingRatePerHour" label="3D modeling" suffix="₪/h" defaultValue={s("modelingRatePerHour")} />
            <NumberField name="scanningRatePerHour" label="3D scanning" suffix="₪/h" defaultValue={s("scanningRatePerHour")} />
            <NumberField name="scanCleanupRatePerHour" label="Scan cleanup" suffix="₪/h" defaultValue={s("scanCleanupRatePerHour")} />
            <NumberField name="reverseEngineeringRatePerHour" label="Reverse engineering" suffix="₪/h" defaultValue={s("reverseEngineeringRatePerHour")} />
          </FormSection>

          <FormSection title="Quotes & payments" description="Defaults for new documents.">
            <NumberField name="quoteValidityDays" label="Quote validity" suffix="days" defaultValue={s("quoteValidityDays")} />
            <NumberField name="defaultDepositPercent" label="Default deposit" suffix="%" defaultValue={s("defaultDepositPercent")} />
            <CheckboxField name="requireDepositToProduce" label="Require the deposit before production" hint="Orders wait in “Awaiting payment” until paid (can be overridden per order with a reason)." defaultChecked={v.requireDepositToProduce === true} className="sm:col-span-2" />
            <TextareaField name="defaultPaymentTerms" label="Default payment terms" defaultValue={s("defaultPaymentTerms")} rows={2} className="sm:col-span-2" />
            <TextareaField name="quoteTerms" label="Quote terms & conditions" defaultValue={s("quoteTerms")} rows={3} className="sm:col-span-2" />
            <TextField name="documentFooter" label="Document footer" defaultValue={s("documentFooter")} className="sm:col-span-2" placeholder="Thank you for your business!" />
          </FormSection>

          <FormSection title="File storage" description="Uploads are stored on the server outside the web root.">
            <NumberField name="maxUploadMb" label="Max file size" suffix="MB" defaultValue={s("maxUploadMb")} />
            <NumberField name="storageQuotaMb" label="Total storage quota" suffix="MB" defaultValue={s("storageQuotaMb")} />
          </FormSection>
          <Alert tone="info" title="Changing rates is safe">
            Existing quotes and orders keep the rates captured when they were priced. Drafts can be re-priced explicitly with “Re-price with current rates”.
          </Alert>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
