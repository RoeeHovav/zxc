"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ActionForm, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EXPENSE_CATEGORIES } from "@/domain/schemas/expense";
import { enumLabel } from "@/lib/labels";
import { isoDate } from "@/lib/format";
import { deleteExpenseAction, saveExpenseAction } from "../actions";

export interface ExpenseValues {
  date?: Date;
  category?: string;
  description?: string;
  supplierId?: string | null;
  amount?: string;
  vatAmount?: string;
  paymentMethod?: string | null;
  reference?: string | null;
  printerId?: string | null;
  orderId?: string | null;
  notes?: string | null;
}

export function ExpenseForm({ id, initial, suppliers, printers, vatRate }: { id: string | null; initial?: ExpenseValues; suppliers: { id: string; name: string }[]; printers: { id: string; name: string }[]; vatRate: string | null }) {
  const router = useRouter();
  const v = initial ?? {};
  const [amount, setAmount] = React.useState(v.amount ?? "");
  const [vat, setVat] = React.useState(v.vatAmount && Number(v.vatAmount) > 0 ? v.vatAmount : "");
  return (
    <Card>
      <CardContent className="py-6">
        <ActionForm
          action={saveExpenseAction.bind(null, id)}
          submitLabel={id ? "Save changes" : "Record expense"}
          successMessage={id ? "Expense saved." : "Expense recorded."}
          redirectTo="/finance/expenses"
          cancel={
            id ? (
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="danger-ghost">
                    <Trash2 /> Delete
                  </Button>
                }
                title="Delete this expense?"
                description="The expense is removed from reports. Spools received with it keep their landed cost."
                confirmLabel="Delete"
                onConfirm={async () => {
                  const r = await deleteExpenseAction(id);
                  if (r.ok) {
                    toast.success("Expense deleted.");
                    router.push("/finance/expenses");
                  } else toast.error(r.error);
                }}
              />
            ) : undefined
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="description" label="Description" required defaultValue={v.description ?? ""} className="sm:col-span-2" autoFocus />
            <SelectField name="category" label="Category" defaultValue={v.category ?? "OTHER"} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: enumLabel("expenseCategory", c) }))} />
            <TextField name="date" label="Date" type="date" defaultValue={isoDate(v.date ?? new Date())} />
            <NumberField name="amount" label="Total paid (incl. VAT)" suffix="₪" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <NumberField
              name="vatAmount"
              label="VAT included"
              suffix="₪"
              value={vat}
              onChange={(e) => setVat(e.target.value)}
              hint={
                vatRate && amount && !vat ? (
                  <button type="button" className="text-primary underline" onClick={() => setVat((Number(amount) - Number(amount) / (1 + Number(vatRate))).toFixed(2))}>
                    Calculate {Math.round(Number(vatRate) * 100)}% VAT from total
                  </button>
                ) : (
                  "Informational — for your VAT reporting."
                )
              }
            />
            <SelectField name="supplierId" label="Supplier" defaultValue={v.supplierId ?? ""} placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            <SelectField name="paymentMethod" label="Paid with" defaultValue={v.paymentMethod ?? ""} placeholder="—" options={["CASH", "BANK_TRANSFER", "CREDIT_CARD", "BIT", "PAYBOX", "PAYPAL", "CHECK", "OTHER"].map((m) => ({ value: m, label: enumLabel("paymentMethod", m) }))} />
            <TextField name="reference" label="Invoice / receipt number" defaultValue={v.reference ?? ""} />
            <SelectField name="printerId" label="Related printer" defaultValue={v.printerId ?? ""} placeholder="None" options={printers.map((p) => ({ value: p.id, label: p.name }))} />
            <TextareaField name="notes" label="Notes" defaultValue={v.notes ?? ""} rows={2} className="sm:col-span-2" />
            {v.orderId && <input type="hidden" name="orderId" value={v.orderId} />}
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
