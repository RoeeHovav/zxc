"use client";
import * as React from "react";
import { CalendarPlus, CheckCheck, ClipboardPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, CheckboxField, NumberField, SelectField, TextField } from "@/components/action-form";
import { isoDate } from "@/lib/format";
import { logMaintenanceAction, saveTaskAction } from "../actions";

export function MaintenanceControls({ printerId, tasks }: { printerId: string; tasks: { id: string; title: string }[] }) {
  const [open, setOpen] = React.useState<null | "task" | "log">(null);
  return (
    <div className="flex gap-2">
      <Dialog open={open === "task"} onOpenChange={(o) => setOpen(o ? "task" : null)}>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">
            <CalendarPlus /> Schedule
          </Button>
        </DialogTrigger>
        <DialogContent title="Schedule maintenance" description="Due when either interval is reached. The clock starts now.">
          <ActionForm action={saveTaskAction.bind(null, printerId)} submitLabel="Save" onSuccess={() => setOpen(null)}>
            <TextField name="title" label="Task" required placeholder="Lubricate carbon rods" autoFocus />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField name="intervalPrintHours" label="Every" suffix="print h" />
              <NumberField name="intervalDays" label="…or every" suffix="days" />
            </div>
            <TextField name="notes" label="Notes" />
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "log"} onOpenChange={(o) => setOpen(o ? "log" : null)}>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">
            <ClipboardPen /> Log work
          </Button>
        </DialogTrigger>
        <DialogContent title="Log maintenance">
          <MaintenanceLogForm printerId={printerId} tasks={tasks} onDone={() => setOpen(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MaintenanceLogForm({
  printerId,
  tasks,
  taskId,
  onDone,
  defaultDescription,
}: {
  printerId: string;
  tasks: { id: string; title: string }[];
  taskId?: string;
  onDone: () => void;
  defaultDescription?: string;
}) {
  return (
    <ActionForm action={logMaintenanceAction.bind(null, printerId)} submitLabel="Record" onSuccess={onDone}>
      <SelectField
        name="taskId"
        label="Scheduled task"
        defaultValue={taskId ?? ""}
        placeholder="Unscheduled work"
        options={tasks.map((t) => ({ value: t.id, label: t.title }))}
        hint="Completing a scheduled task resets its interval."
      />
      <TextField name="description" label="What was done" required defaultValue={defaultDescription ?? ""} autoFocus />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField name="cost" label="Cost" suffix="₪" />
        <TextField name="performedAt" label="Date" type="date" defaultValue={isoDate(new Date())} />
      </div>
      <CheckboxField name="recordExpense" label="Record cost as an expense" defaultChecked />
    </ActionForm>
  );
}

export function TaskDoneButton({ printerId, taskId, title }: { printerId: string; taskId: string; title: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <CheckCheck /> Done
        </Button>
      </DialogTrigger>
      <DialogContent title={`Complete: ${title}`}>
        <MaintenanceLogForm printerId={printerId} tasks={[{ id: taskId, title }]} taskId={taskId} defaultDescription={title} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
