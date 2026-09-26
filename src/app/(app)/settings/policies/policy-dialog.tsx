"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField } from "@/components/action-form";
import { archivePolicyAction, savePolicyAction } from "../actions";

type Values = {
  name: string;
  description: string;
  method: string;
  markupPercent: string;
  marginPercent: string;
  minimumOrderCharge: string;
  minimumMarginPercent: string;
  priceRoundingStep: string;
  roundingMode: string;
  isDefault: boolean;
};

export function PolicyDialog({ id, initial }: { id?: string; initial?: Values }) {
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState(initial?.method ?? "MARKUP");
  const v = initial ?? {
    name: "",
    description: "",
    method: "MARKUP",
    markupPercent: "100",
    marginPercent: "50",
    minimumOrderCharge: "30",
    minimumMarginPercent: "30",
    priceRoundingStep: "1",
    roundingMode: "UP",
    isDefault: false,
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {id ? (
          <Button size="sm" variant="ghost">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New policy
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={id ? `Edit ${v.name}` : "New pricing policy"}>
        <ActionForm action={savePolicyAction.bind(null, id ?? null)} submitLabel="Save policy" onSuccess={() => setOpen(false)}>
          <TextField name="name" label="Name" required defaultValue={v.name} placeholder="Wholesale" />
          <TextField name="description" label="Description" defaultValue={v.description} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="method"
              label="Method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={[
                { value: "MARKUP", label: "Markup on cost" },
                { value: "MARGIN", label: "Target gross margin" },
              ]}
            />
            {method === "MARKUP" ? (
              <NumberField name="markupPercent" label="Markup" suffix="%" defaultValue={v.markupPercent} />
            ) : (
              <NumberField name="marginPercent" label="Target margin" suffix="%" defaultValue={v.marginPercent} hint="Must be below 100%." />
            )}
            <NumberField name="minimumOrderCharge" label="Minimum order" suffix="₪" defaultValue={v.minimumOrderCharge} />
            <NumberField name="minimumMarginPercent" label="Warn below margin" suffix="%" defaultValue={v.minimumMarginPercent} />
            <NumberField name="priceRoundingStep" label="Round unit prices to" suffix="₪" defaultValue={v.priceRoundingStep} hint="0 = agorot only" />
            <SelectField
              name="roundingMode"
              label="Rounding"
              defaultValue={v.roundingMode}
              options={[
                { value: "UP", label: "Always up" },
                { value: "NEAREST", label: "Nearest" },
              ]}
            />
          </div>
          <CheckboxField name="isDefault" label="Use as default policy" defaultChecked={v.isDefault} />
          {method === "MARKUP" ? <input type="hidden" name="marginPercent" value={v.marginPercent} /> : <input type="hidden" name="markupPercent" value={v.markupPercent} />}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function PolicyArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        const r = await archivePolicyAction(id, !archived);
        if (r.ok) {
          toast.success(r.message);
          router.refresh();
        } else toast.error(r.error);
      }}
    >
      {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
    </Button>
  );
}
