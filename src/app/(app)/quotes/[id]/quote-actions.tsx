"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, GitBranch, MoreHorizontal, Pencil, Send, Trash2, X, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { acceptQuoteAction, convertQuoteAction, deleteQuoteAction, rejectQuoteAction, reviseQuoteAction, sendQuoteAction } from "../actions";

type R = { ok: boolean; error?: string; message?: string };

export function QuoteActions({ id, status, pricingComplete, hasOrder, number }: { id: string; status: string; pricingComplete: boolean; hasOrder: boolean; number: string }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<null | "accept" | "reject">(null);
  const [note, setNote] = React.useState("");
  const [createOrder, setCreateOrder] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const run = async <T extends R>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        after?.(r);
        router.refresh();
      } else toast.error(r.error);
      return r;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {status === "DRAFT" && (
        <>
          <Button variant="secondary" asChild>
            <Link href={`/quotes/${id}/edit`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button onClick={() => run(() => sendQuoteAction(id))} loading={busy} disabled={!pricingComplete} title={pricingComplete ? undefined : "Resolve pricing errors first"}>
            <Send /> Mark as sent
          </Button>
        </>
      )}
      {(status === "SENT" || status === "EXPIRED") && (
        <>
          <Button variant="secondary" onClick={() => setDialog("reject")}>
            <X /> Rejected
          </Button>
          {status === "SENT" && (
            <Button onClick={() => setDialog("accept")}>
              <Check /> Customer accepted
            </Button>
          )}
        </>
      )}
      {status === "ACCEPTED" && !hasOrder && (
        <Button onClick={() => run(() => convertQuoteAction(id), (r) => r.ok && "data" in r && router.push(`/orders/${(r as { data: { orderId: string } }).data.orderId}`))} loading={busy}>
          <ArrowRightLeft /> Create order
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="More quote actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {["SENT", "REJECTED", "EXPIRED"].includes(status) && (
            <DropdownMenuItem onSelect={() => run(() => reviseQuoteAction(id), (r) => "data" in r && router.push(`/quotes/${(r as { data: { id: string } }).data.id}/edit`))}>
              <GitBranch /> Create revision
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/quotes/new?from=${id}`}>
              <Copy /> Duplicate as new quote
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {status === "DRAFT" && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon" aria-label="Delete draft">
              <Trash2 />
            </Button>
          }
          title={`Delete draft ${number}?`}
          description="The draft and its items are permanently removed. Sent quotes are never deleted."
          confirmLabel="Delete draft"
          onConfirm={() => run(() => deleteQuoteAction(id), () => router.push("/quotes"))}
        />
      )}

      <Dialog open={dialog === "accept"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Record customer approval" description="Note how the customer approved (e.g. “WhatsApp message 12 Mar”). The quote becomes final.">
          <div className="grid gap-4">
            <Field label="Approval note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approved by phone" autoFocus />
            </Field>
            <Checkbox checked={createOrder} onChange={(e) => setCreateOrder(e.target.checked)} label="Create and confirm the order now" hint="Copies all items with the quoted prices, reserves material and starts modeling projects." />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run(
                  () => acceptQuoteAction(id, note, createOrder),
                  (r) => {
                    setDialog(null);
                    const orderId = (r as unknown as { data: { orderId: string | null } }).data.orderId;
                    if (orderId) router.push(`/orders/${orderId}`);
                  },
                )
              }
            >
              Confirm acceptance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Mark as rejected" description="You can still create a revision later.">
          <Field label="Reason (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Too expensive, chose another supplier…" autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => run(() => rejectQuoteAction(id, note), () => setDialog(null))}>
              Mark rejected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
