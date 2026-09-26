"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Download, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField } from "@/components/action-form";
import { Badge } from "@/components/ui/misc";
import { enumLabel } from "@/lib/labels";
import { date, isoDate, money } from "@/lib/format";
import { dec, ZERO } from "@/domain/money";
import { recordPaymentAction, voidPaymentAction } from "../actions";

interface P {
  id: string;
  number: string;
  kind: string;
  method: string;
  amount: string;
  receivedAt: string;
  isDeposit: boolean;
  reference: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  feeAmount: string;
}

const METHODS = ["CASH", "BANK_TRANSFER", "CREDIT_CARD", "BIT", "PAYBOX", "PAYPAL", "CHECK", "OTHER"];

export function PaymentsPanel({
  orderId,
  status,
  total,
  paid,
  balance,
  deposit,
  payments,
}: {
  orderId: string;
  status: string;
  total: string;
  paid: string;
  balance: string;
  deposit: string;
  payments: P[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<null | "PAYMENT" | "REFUND">(null);
  const [key, setKey] = React.useState("");
  const [voidReason, setVoidReason] = React.useState("");
  const openDialog = (k: "PAYMENT" | "REFUND") => {
    setKey(`${orderId}-${k}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setOpen(k);
  };
  const b = dec(balance);
  const depositDue = D0(deposit).gt(dec(paid)) ? D0(deposit).minus(dec(paid)) : ZERO;
  const canPay = !["DRAFT", "CANCELED", "COMPLETED"].includes(status) && b.gt(0);
  const canRefund = dec(paid).gt(0);

  return (
    <Card>
      <CardHeader
        title="Payments"
        actions={
          <>
            {canRefund && (
              <Button size="sm" variant="ghost" onClick={() => openDialog("REFUND")}>
                <Undo2 /> Refund
              </Button>
            )}
            {canPay && (
              <Button size="sm" onClick={() => openDialog("PAYMENT")}>
                <Plus /> Record payment
              </Button>
            )}
          </>
        }
      />
      <CardContent className="grid gap-3 text-sm">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-3 text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="tabular font-semibold">{status === "CANCELED" ? "—" : money(total)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Paid</p>
            <p className="tabular font-semibold">{money(paid)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">{b.lt(0) ? "Credit / refund due" : "Balance"}</p>
            <p className={`tabular font-semibold ${b.gt(0) ? "text-warning" : b.lt(0) ? "text-info" : "text-success"}`}>{money(b.abs().toFixed(2))}</p>
          </div>
        </div>
        {depositDue.gt(0) && status !== "CANCELED" && <p className="text-xs text-warning">Deposit outstanding: {money(depositDue.toFixed(2))}</p>}
        {payments.length === 0 ? (
          <p className="text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-start justify-between gap-2 py-2 ${p.voidedAt ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.kind === "REFUND" ? "Refund" : p.isDeposit ? "Deposit" : "Payment"} · {enumLabel("paymentMethod", p.method)}
                    {p.voidedAt && (
                      <Badge tone="muted" className="ms-2">
                        void
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.number} · {date(p.receivedAt)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {Number(p.feeAmount) > 0 ? ` · fee ${money(p.feeAmount)}` : ""}
                  </p>
                  {p.voidReason && <p className="text-xs text-muted-foreground">Voided: {p.voidReason}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <span className={`tabular whitespace-nowrap ${p.kind === "REFUND" ? "text-destructive" : ""}`}>
                    {p.kind === "REFUND" ? "−" : ""}
                    {money(p.amount)}
                  </span>
                  {!p.voidedAt && p.kind === "PAYMENT" && (
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" aria-label={`Payment acknowledgement ${p.number}`} title="Payment acknowledgement (PDF)">
                        <Download />
                      </a>
                    </Button>
                  )}
                  {!p.voidedAt && (
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Void ${p.number}`} title="Void (entered by mistake)">
                          <Ban />
                        </Button>
                      }
                      title={`Void ${p.number}?`}
                      description={
                        <span className="grid gap-3">
                          <span>
                            Use only for entries made by mistake. The record stays visible, marked void, and totals are recalculated. For money returned to the customer, record a refund instead.
                          </span>
                          <input
                            className="h-9 rounded-md border border-input bg-card px-3 text-foreground"
                            placeholder="Reason"
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            aria-label="Reason for voiding"
                          />
                        </span>
                      }
                      confirmLabel="Void entry"
                      onConfirm={async () => {
                        const r = await voidPaymentAction(orderId, p.id, voidReason);
                        if (r.ok) {
                          toast.success("Entry voided.");
                          setVoidReason("");
                          router.refresh();
                        } else toast.error(r.error);
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent title={open === "REFUND" ? "Record refund" : "Record payment"} description={open === "REFUND" ? `Up to ${money(paid)} can be refunded.` : `Balance due ${money(balance)}.`}>
          <ActionForm action={recordPaymentAction.bind(null, orderId)} submitLabel={open === "REFUND" ? "Record refund" : "Record payment"} onSuccess={() => setOpen(null)}>
            <input type="hidden" name="kind" value={open ?? "PAYMENT"} />
            <input type="hidden" name="idempotencyKey" value={key} />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField name="amount" label="Amount" suffix="₪" required defaultValue={open === "REFUND" ? "" : depositDue.gt(0) ? depositDue.toFixed(2) : b.gt(0) ? b.toFixed(2) : ""} autoFocus />
              <SelectField name="method" label="Method" defaultValue="BIT" options={METHODS.map((m) => ({ value: m, label: enumLabel("paymentMethod", m) }))} />
              <TextField name="receivedAt" label="Date" type="date" defaultValue={isoDate(new Date())} />
              <TextField name="reference" label="Reference" placeholder="Transaction / check no." />
              {open === "PAYMENT" && <NumberField name="feeAmount" label="Processing fee you paid" suffix="₪" hint="e.g. card fee; internal cost" />}
            </div>
            {open === "PAYMENT" && <CheckboxField name="isDeposit" label="This is a deposit" defaultChecked={depositDue.gt(0)} />}
            <TextField name="notes" label="Notes" />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function D0(v: string) {
  try {
    return dec(v);
  } catch {
    return ZERO;
  }
}
