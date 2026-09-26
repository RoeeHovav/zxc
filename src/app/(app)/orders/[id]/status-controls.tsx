"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, ChevronDown, CircleCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { enumLabel } from "@/lib/labels";
import { transitionOrderAction } from "../actions";

type T = { to: string; ok: boolean; reasons: string[]; overridable: boolean };

const ACTION_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Wait for deposit",
  AWAITING_MODELING: "Back to modeling",
  AWAITING_APPROVAL: "Design sent for approval",
  QUEUED: "Queue for production",
  PRINTING: "Mark printing",
  POST_PROCESSING: "Post-processing",
  QUALITY_CHECK: "Quality check",
  READY: "Mark ready for delivery",
  DELIVERED: "Mark delivered",
  COMPLETED: "Complete order",
  CANCELED: "Cancel order",
};

/** Preferred forward step per status (shown as the primary button). */
const PRIMARY: Record<string, string[]> = {
  DRAFT: ["AWAITING_PAYMENT", "AWAITING_MODELING", "QUEUED"],
  AWAITING_PAYMENT: ["QUEUED", "AWAITING_MODELING"],
  AWAITING_MODELING: ["AWAITING_APPROVAL", "QUEUED"],
  AWAITING_APPROVAL: ["QUEUED"],
  QUEUED: ["READY"],
  PRINTING: ["READY"],
  POST_PROCESSING: ["READY"],
  QUALITY_CHECK: ["READY"],
  READY: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
};

export function OrderStatusControls({ id, status, transitions, pricingComplete }: { id: string; status: string; transitions: T[]; pricingComplete: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<T | null>(null);
  const [reason, setReason] = React.useState("");

  if (status === "COMPLETED" || status === "CANCELED") return null;

  const go = async (to: string, withReason?: string) => {
    setBusy(true);
    try {
      const r = await transitionOrderAction(id, to, withReason ?? null);
      if (r.ok) {
        toast.success(to === "CANCELED" ? "Order canceled." : `Moved to ${enumLabel("orderStatus", r.data.status).toLowerCase()}.`);
        setPending(null);
        setReason("");
        router.refresh();
      } else toast.error(r.error);
    } finally {
      setBusy(false);
    }
  };

  const start = (t: T) => {
    if (t.to === "CANCELED" || (!t.ok && t.overridable)) {
      setPending(t);
      return;
    }
    void go(t.to);
  };

  if (status === "DRAFT") {
    return (
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">Draft order</p>
          <p className="text-muted-foreground">
            {pricingComplete
              ? "Confirming reserves material, creates design projects where needed, and moves the order into its first stage."
              : "Resolve pricing errors (edit the order) before confirming."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => start({ to: "CANCELED", ok: true, reasons: [], overridable: true })}>
            <Ban /> Cancel
          </Button>
          <Button onClick={() => go("QUEUED")} loading={busy} disabled={!pricingComplete}>
            <CircleCheck /> Confirm order
          </Button>
        </div>
      </Card>
    );
  }

  const forward = transitions.filter((t) => t.to !== "CANCELED");
  const primary = (PRIMARY[status] ?? []).map((s) => forward.find((t) => t.to === s)).find(Boolean) ?? null;
  const others = forward.filter((t) => t !== primary);
  const cancel = transitions.find((t) => t.to === "CANCELED");

  return (
    <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium">Next step</p>
        {primary && !primary.ok ? (
          <ul className="mt-1 grid gap-0.5 text-muted-foreground">
            {primary.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Lock className="mt-0.5 size-3.5 shrink-0" /> {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{primary ? `Ready to ${ACTION_LABEL[primary.to].toLowerCase()}.` : "Production progress updates this order automatically."}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {cancel && (
          <Button variant="ghost" onClick={() => start(cancel)} disabled={busy}>
            <Ban /> Cancel
          </Button>
        )}
        {others.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                Other status <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {others.map((t) => (
                <DropdownMenuItem key={t.to} disabled={!t.ok && !t.overridable} onSelect={() => start(t)}>
                  {!t.ok && <Lock />} {ACTION_LABEL[t.to]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {primary && (
          <Button onClick={() => start(primary)} loading={busy} disabled={!primary.ok && !primary.overridable}>
            {ACTION_LABEL[primary.to]} {primary.ok ? <ArrowRight /> : <Lock />}
          </Button>
        )}
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent
          title={pending?.to === "CANCELED" ? "Cancel this order?" : `Override: ${pending ? ACTION_LABEL[pending.to] : ""}`}
          description={
            pending?.to === "CANCELED"
              ? "Reserved material is released and queued jobs are canceled. Payments stay on record — record refunds separately."
              : "This step is normally blocked. The override and your reason are recorded in the order history."
          }
        >
          {pending && pending.reasons.length > 0 && (
            <ul className="mb-4 grid gap-1 rounded-lg bg-warning-soft p-3 text-sm text-warning">
              {pending.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <Field label="Reason" required hint="At least 3 characters.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Back
            </Button>
            <Button variant={pending?.to === "CANCELED" ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 3} onClick={() => pending && go(pending.to, reason)}>
              {pending?.to === "CANCELED" ? "Cancel order" : "Override and continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
