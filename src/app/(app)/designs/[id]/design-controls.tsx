"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, CircleDollarSign, MessageSquareWarning, Play, Send, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { enumLabel } from "@/lib/labels";
import { date, isoDate, money, num } from "@/lib/format";
import { billRevisionsAction, completeRevisionAction, deleteTimeAction, designStatusAction, logTimeAction, requestRevisionAction } from "../actions";

const NEXT: Record<string, { to: string; label: string; icon: React.ComponentType<{ className?: string }>; variant?: "primary" | "secondary" | "danger-ghost"; note?: boolean }[]> = {
  REQUESTED: [{ to: "IN_PROGRESS", label: "Start work", icon: Play }],
  IN_PROGRESS: [{ to: "AWAITING_APPROVAL", label: "Sent to customer for approval", icon: Send }],
  AWAITING_APPROVAL: [{ to: "APPROVED", label: "Customer approved", icon: Check, note: true }],
  REVISION_REQUESTED: [{ to: "IN_PROGRESS", label: "Resume work", icon: Play }],
  APPROVED: [{ to: "DELIVERED", label: "Files delivered", icon: Truck }],
  DELIVERED: [],
  CANCELED: [],
};

export function DesignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const go = async (to: string, n: string | null = null) => {
    setBusy(true);
    const r = await designStatusAction(id, to, n);
    setBusy(false);
    if (r.ok) {
      toast.success(`Now ${enumLabel("designStatus", to).toLowerCase()}.`);
      setNoteFor(null);
      router.refresh();
    } else toast.error(r.error);
  };
  const actions = NEXT[status] ?? [];
  if (actions.length === 0 && !["REQUESTED", "IN_PROGRESS", "AWAITING_APPROVAL", "REVISION_REQUESTED"].includes(status)) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-sm text-muted-foreground">Status: <span className="font-medium text-foreground">{enumLabel("designStatus", status)}</span></p>
      <div className="flex flex-wrap gap-2">
        {["REQUESTED", "IN_PROGRESS", "AWAITING_APPROVAL", "REVISION_REQUESTED"].includes(status) && (
          <Button variant="danger-ghost" onClick={() => go("CANCELED")} disabled={busy}>
            <X /> Cancel project
          </Button>
        )}
        {actions.map((a) => (
          <Button key={a.to} onClick={() => (a.note ? setNoteFor(a.to) : go(a.to))} loading={busy}>
            <a.icon /> {a.label}
          </Button>
        ))}
      </div>
      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent title="Record customer approval" description="How did the customer approve? This is kept with the design.">
          <Field label="Approval note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approved via WhatsApp, 12 Mar" autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => noteFor && go(noteFor, note)}>
              Confirm approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const CATS = ["MODELING", "SCANNING", "SCAN_CLEANUP", "REVERSE_ENGINEERING", "REVISION", "OTHER"];

export function TimeLog({ id, entries, byCategory }: { id: string; entries: { id: string; category: string; hours: string; date: string; billable: boolean; notes: string | null }[]; byCategory: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <CardHeader
        title="Time log"
        description="Scanning, cleanup and reverse engineering are tracked separately from modeling."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Log time</Button>
            </DialogTrigger>
            <DialogContent title="Log time">
              <ActionForm action={logTimeAction.bind(null, id)} submitLabel="Log time" onSuccess={() => setOpen(false)}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField name="category" label="Activity" defaultValue="MODELING" options={CATS.map((c) => ({ value: c, label: enumLabel("timeCategory", c) }))} />
                  <NumberField name="hours" label="Hours" suffix="h" required autoFocus />
                  <TextField name="date" label="Date" type="date" defaultValue={isoDate(new Date())} />
                </div>
                <CheckboxField name="billable" label="Billable" defaultChecked />
                <TextField name="notes" label="Notes" />
              </ActionForm>
            </DialogContent>
          </Dialog>
        }
      />
      {Object.keys(byCategory).length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {Object.entries(byCategory).map(([k, v]) => (
            <Badge key={k}>
              {enumLabel("timeCategory", k)} {num(v)} h
            </Badge>
          ))}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">No time logged yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <p>
                  <span className="font-medium">{enumLabel("timeCategory", e.category)}</span> · {num(e.hours)} h{!e.billable && <span className="text-muted-foreground"> (non-billable)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {date(e.date)}
                  {e.notes ? ` · ${e.notes}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove entry"
                onClick={async () => {
                  const r = await deleteTimeAction(id, e.id);
                  if (r.ok) router.refresh();
                  else toast.error(r.error);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RevisionControls({
  id,
  status,
  included,
  fee,
  revisions,
}: {
  id: string;
  status: string;
  included: number;
  fee: string | null;
  revisions: { id: string; number: number; description: string; isChargeable: boolean; charge: string | null; billedAt: string | null; completedAt: string | null; requestedAt: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const canRequest = ["AWAITING_APPROVAL", "APPROVED", "DELIVERED"].includes(status);
  const unbilled = revisions.filter((r) => r.isChargeable && !r.billedAt && r.charge);
  return (
    <Card>
      <CardHeader
        title="Revisions"
        description={`${included} included${fee ? ` · extra revisions ${money(fee)} each` : " · set an extra revision fee to bill additional work"}`}
        actions={
          <>
            {unbilled.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await billRevisionsAction(id);
                  if (r.ok) {
                    toast.success(r.message);
                    router.push(`/orders/${r.data.orderId}`);
                  } else toast.error(r.error);
                }}
              >
                <CircleDollarSign /> Bill {unbilled.length} extra
              </Button>
            )}
            {canRequest && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <MessageSquareWarning /> Changes requested
                  </Button>
                </DialogTrigger>
                <DialogContent title="Customer requested changes" description={revisions.length + 1 > included ? `This will be revision ${revisions.length + 1} — beyond the ${included} included, so it is chargeable.` : `Revision ${revisions.length + 1} of ${included} included.`}>
                  <ActionForm action={requestRevisionAction.bind(null, id)} submitLabel="Record revision" onSuccess={() => setOpen(false)}>
                    <TextareaField name="description" label="What should change?" required rows={3} autoFocus />
                  </ActionForm>
                </DialogContent>
              </Dialog>
            )}
          </>
        }
      />
      {revisions.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">No revisions requested.</p>
      ) : (
        <ul className="divide-y divide-border">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  Revision {r.number}
                  {r.isChargeable && (
                    <Badge tone="warning" className="ms-2">
                      chargeable{r.charge ? ` ${money(r.charge)}` : ""}
                    </Badge>
                  )}
                  {r.billedAt && <Badge tone="success" className="ms-2">billed</Badge>}
                </p>
                <p className="text-muted-foreground">{r.description}</p>
                <p className="text-xs text-muted-foreground">
                  Requested {date(r.requestedAt)}
                  {r.completedAt ? ` · done ${date(r.completedAt)}` : ""}
                </p>
              </div>
              {!r.completedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const res = await completeRevisionAction(id, r.id);
                    if (res.ok) router.refresh();
                    else toast.error(res.error);
                  }}
                >
                  <CheckCheck /> Done
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
