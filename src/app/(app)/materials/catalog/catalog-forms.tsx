"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, NumberField, TextField, TextareaField } from "@/components/action-form";
import { createSupplierAction, createTypeAction } from "../actions";

export function CatalogForms({ kind }: { kind: "type" | "supplier" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Add
        </Button>
      </DialogTrigger>
      {kind === "type" ? (
        <DialogContent title="New material type">
          <ActionForm action={createTypeAction} submitLabel="Add type" onSuccess={() => setOpen(false)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="code" label="Code" required placeholder="PA-CF" autoFocus />
              <TextField name="name" label="Name" required placeholder="Nylon Carbon Fiber" />
            </div>
            <NumberField name="defaultDensity" label="Typical density" suffix="g/cm³" />
            <TextareaField name="description" label="Notes" rows={2} />
          </ActionForm>
        </DialogContent>
      ) : (
        <DialogContent title="New supplier">
          <ActionForm action={createSupplierAction} submitLabel="Add supplier" onSuccess={() => setOpen(false)}>
            <TextField name="name" label="Name" required autoFocus />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="contactName" label="Contact person" />
              <TextField name="phone" label="Phone" type="tel" />
              <TextField name="email" label="Email" type="email" />
              <TextField name="website" label="Website" />
            </div>
            <TextareaField name="notes" label="Notes" rows={2} />
          </ActionForm>
        </DialogContent>
      )}
    </Dialog>
  );
}
