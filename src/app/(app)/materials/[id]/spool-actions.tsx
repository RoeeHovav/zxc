"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Scale, Trash, CircleOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { ActionForm, NumberField, TextField } from "@/components/action-form";
import { reconcileSpoolAction, spoolStatusAction, wasteAction } from "../actions";

export function SpoolActions({ spoolId, materialId, code, hasEmptyWeight }: { spoolId: string; materialId: string; code: string; hasEmptyWeight: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<null | "weigh" | "waste">(null);
  const close = () => setDialog(null);
  return (
    <>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="secondary" onClick={() => setDialog("weigh")}>
          <Scale /> Weigh
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${code}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setDialog("waste")}>
              <Trash /> Record waste
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const r = await spoolStatusAction(spoolId, materialId, "EMPTY");
                if (r.ok) toast.success(`${code} marked empty.`);
                else toast.error(r.error);
                router.refresh();
              }}
            >
              <CircleOff /> Mark empty
            </DropdownMenuItem>
            <DropdownMenuItem
              danger
              onSelect={async () => {
                const r = await spoolStatusAction(spoolId, materialId, "DISCARDED");
                if (r.ok) toast.success(`${code} discarded.`);
                else toast.error(r.error);
                router.refresh();
              }}
            >
              <Trash /> Discard (e.g. moisture damage)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={dialog === "weigh"} onOpenChange={(o) => !o && close()}>
        <DialogContent title={`Weigh ${code}`} description="Replaces the estimate with a measured value and records the difference in the ledger.">
          <ActionForm action={reconcileSpoolAction.bind(null, spoolId, materialId)} submitLabel="Save weight" onSuccess={close}>
            {hasEmptyWeight && <NumberField name="grossWeightG" label="Scale reading (spool + filament)" suffix="g" autoFocus />}
            <NumberField name="remainingG" label={hasEmptyWeight ? "…or net filament remaining" : "Net filament remaining"} suffix="g" autoFocus={!hasEmptyWeight} hint={hasEmptyWeight ? "Fill one of the two." : "Set the empty spool weight on the material to enter scale readings directly."} />
            <TextField name="note" label="Note" placeholder="Monthly weigh-in" />
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "waste"} onOpenChange={(o) => !o && close()}>
        <DialogContent title={`Record waste on ${code}`} description="For tangles, test prints, calibration or damaged filament. Failed jobs are recorded from the production board.">
          <ActionForm action={wasteAction.bind(null, spoolId, materialId)} submitLabel="Record waste" onSuccess={close}>
            <NumberField name="grams" label="Grams wasted" suffix="g" required autoFocus />
            <TextField name="reason" label="Reason" required placeholder="Calibration prints" />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
