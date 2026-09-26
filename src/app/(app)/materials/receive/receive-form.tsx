"use client";
import * as React from "react";
import Link from "next/link";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { D } from "@/domain/money";
import { money } from "@/lib/format";
import { isoDate } from "@/lib/format";
import { receiveSpoolsAction } from "../actions";

export function ReceiveForm({ materials, suppliers, defaultMaterialId, vatRegistered, vatRate }: { materials: { id: string; label: string }[]; suppliers: { id: string; name: string }[]; defaultMaterialId: string; vatRegistered: boolean; vatRate: string }) {
  const [count, setCount] = React.useState("1");
  const [net, setNet] = React.useState("1000");
  const [price, setPrice] = React.useState("");
  const [ship, setShip] = React.useState("");
  const [inclVat, setInclVat] = React.useState(true);

  let preview: { per: string; perKg: string } | null = null;
  try {
    const n = Number(count);
    if (n >= 1 && Number(net) > 0 && price !== "") {
      const toNet = (v: InstanceType<typeof D>) => (vatRegistered && inclVat ? v.div(new D(vatRate).plus(1)) : v);
      const per = toNet(new D(price)).plus(toNet(new D(ship || "0")).div(n)).toDecimalPlaces(2);
      preview = { per: per.toFixed(2), perKg: per.div(new D(net).div(1000)).toDecimalPlaces(2).toFixed(2) };
    }
  } catch {
    preview = null;
  }

  if (materials.length === 0)
    return (
      <Alert tone="info" title="Add a material first">
        <Link href="/materials/new" className="underline">
          Create the material
        </Link>{" "}
        you are receiving, then come back.
      </Alert>
    );

  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm action={receiveSpoolsAction} submitLabel="Receive spools" redirectTo={(d: { materialId: string }) => `/materials/${d.materialId}`} successMessage="Spools received.">
          <SelectField name="materialId" label="Material" required defaultValue={defaultMaterialId} placeholder="Select material…" options={materials.map((m) => ({ value: m.id, label: m.label }))} />
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField name="spoolCount" label="Spools" required value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
            <NumberField name="netWeightG" label="Net filament per spool" suffix="g" required value={net} onChange={(e) => setNet(e.target.value)} />
            <NumberField name="pricePerSpool" label="Price per spool" suffix="₪" required value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField name="shippingTotal" label="Shipping (total)" suffix="₪" value={ship} onChange={(e) => setShip(e.target.value)} hint="Split evenly across spools." />
            <SelectField name="supplierId" label="Supplier" placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            <TextField name="purchasedAt" label="Purchase date" type="date" defaultValue={isoDate(new Date())} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="reference" label="Invoice / order reference" />
            <TextField name="storageLocation" label="Storage location" placeholder="Uses the material default" />
          </div>
          <div className="grid gap-3">
            <CheckboxField
              name="pricesIncludeVat"
              label="Prices include VAT"
              checked={inclVat}
              onChange={(e) => setInclVat(e.target.checked)}
              hint={vatRegistered ? "VAT is reclaimable for your business, so it is excluded from material cost." : "Your business is VAT-exempt, so VAT is part of the material cost."}
            />
            <CheckboxField name="recordExpense" label="Record the purchase as an expense" defaultChecked />
            <CheckboxField name="updateMaterialPrice" label="Update the material's price per kg from this purchase" defaultChecked hint="Existing quotes and orders keep their original prices." />
          </div>
          {preview && (
            <div className="rounded-lg bg-muted px-4 py-3 text-sm">
              Landed cost <strong className="tabular">{money(preview.per)}</strong> per spool → <strong className="tabular">{money(preview.perKg)}</strong> per kg
            </div>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  );
}
