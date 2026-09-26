"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Ban, CheckCircle2, Clock, Flag, MoreHorizontal, Play, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { JOB_STATUS_TONE, enumLabel } from "@/lib/labels";
import { APP_TZ, date, dateTime, grams, minutesToHuman } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNow } from "@/components/use-now";
import { advanceJobAction, assignJobAction, cancelJobAction, finishPrintAction, reorderJobAction, reprintAction, startJobAction, undoStartAction } from "./actions";

export interface BoardJob {
  id: string;
  number: string;
  status: string;
  printerId: string | null;
  printerName: string | null;
  orderId: string;
  orderNumber: string;
  customer: string;
  dueDate: string | null;
  priority: string;
  materialId: string | null;
  materialLabel: string | null;
  colorHex: string | null;
  estimatedMinutes: string | null;
  estimatedGrams: string | null;
  actualMinutes: string | null;
  actualGrams: string | null;
  startedAt: string | null;
  queuePosition: number;
  failureReason: string | null;
  hasReprint: boolean;
  isReprint: boolean;
  items: { id: string; partName: string; quantity: number; quantityGood: number | null; materialId: string | null }[];
}
type Printer = { id: string; name: string; status: string };
type Spool = { id: string; code: string; materialId: string; remainingG: string; measured: boolean; label: string };

const COLUMNS = ["QUEUED", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"] as const;
type Dialogs = { kind: "finish"; job: BoardJob; outcome: string } | { kind: "advance"; job: BoardJob; to: string } | { kind: "start"; job: BoardJob } | null;

export function ProductionBoard({ jobs, printers, spools, highlight, initialView }: { jobs: BoardJob[]; printers: Printer[]; spools: Spool[]; highlight: string | null; initialView: "board" | "queues" }) {
  const router = useRouter();
  const [view, setView] = React.useState(initialView);
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // Time-dependent values are computed only on the client so server and browser render identically.
  const now = useNow();

  React.useEffect(() => {
    if (highlight) document.getElementById(`job-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(id);
    try {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Updated.");
        router.refresh();
      } else toast.error(r.error);
      return r.ok;
    } finally {
      setBusy(null);
    }
  };

  const start = (job: BoardJob) => {
    if (!job.printerId) setDialog({ kind: "start", job });
    else void run(job.id, () => startJobAction(job.id, null));
  };

  /** Moving a card to a column maps to the right action (with a dialog where data is needed). */
  const moveTo = (job: BoardJob, to: string) => {
    if (job.status === to) return;
    if (job.status === "QUEUED" && to === "PRINTING") return start(job);
    if (job.status === "PRINTING" && to === "QUEUED") return void run(job.id, () => undoStartAction(job.id));
    if (job.status === "PRINTING" && ["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"].includes(to)) return setDialog({ kind: "finish", job, outcome: to });
    if (["POST_PROCESSING", "QUALITY_CHECK"].includes(job.status) && ["POST_PROCESSING", "QUALITY_CHECK", "DONE", "FAILED"].includes(to)) {
      if (to === "DONE" || to === "FAILED") return setDialog({ kind: "advance", job, to });
      return void run(job.id, () => advanceJobAction(job.id, JSON.stringify({ to })));
    }
    toast.error(`A job cannot move from ${enumLabel("jobStatus", job.status).toLowerCase()} to ${enumLabel("jobStatus", to).toLowerCase()}.`);
  };

  const card = (j: BoardJob, compact = false) => {
    const overdue = now !== null && j.dueDate && new Date(j.dueDate).getTime() < now && !["DONE", "FAILED"].includes(j.status);
    return (
      <article
        key={j.id}
        id={`job-${j.id}`}
        draggable={!["DONE", "FAILED"].includes(j.status)}
        onDragStart={(e) => {
          setDragId(j.id);
          e.dataTransfer.setData("text/plain", j.id);
        }}
        onDragEnd={() => setDragId(null)}
        className={cn(
          "grid gap-2 rounded-lg border bg-card p-3 text-sm shadow-[var(--shadow-card)]",
          highlight === j.id ? "border-primary ring-2 ring-primary/30" : "border-border",
          dragId === j.id && "opacity-50",
          !["DONE", "FAILED"].includes(j.status) && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={`Job ${j.number}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">
              {j.number}
              {j.isReprint && <Badge tone="warning" className="ms-1.5">reprint</Badge>}
              {(j.priority === "RUSH" || j.priority === "HIGH") && (
                <Badge tone="danger" className="ms-1.5">
                  <Flag className="size-3" /> {enumLabel("priority", j.priority)}
                </Badge>
              )}
            </p>
            <Link href={`/orders/${j.orderId}`} className="block truncate text-xs text-muted-foreground hover:text-primary">
              {j.orderNumber} · {j.customer}
            </Link>
          </div>
          <JobMenu job={j} onCancel={() => run(j.id, () => cancelJobAction(j.id))} onReprint={() => run(j.id, () => reprintAction(j.id))} onUndo={() => run(j.id, () => undoStartAction(j.id))} printers={printers} onAssign={(pid) => run(j.id, () => assignJobAction(j.id, pid, null))} />
        </div>
        <ul className="text-xs">
          {j.items.map((i) => (
            <li key={i.id} className="truncate">
              <span className="tabular font-medium">{i.quantity}×</span> {i.partName}
              {i.quantityGood !== null && i.quantityGood < i.quantity && <span className="text-destructive"> · {i.quantity - i.quantityGood} rejected</span>}
            </li>
          ))}
        </ul>
        {!compact && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {j.materialLabel && (
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full border border-border" style={{ background: j.colorHex ?? "transparent" }} aria-hidden />
                {j.materialLabel}
              </span>
            )}
            <span>{j.printerName ?? <span className="text-warning">no printer</span>}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {j.actualMinutes ? minutesToHuman(j.actualMinutes) : `${minutesToHuman(j.estimatedMinutes)} est.`}
          </span>
          <span>{j.actualGrams ? grams(j.actualGrams) : `${grams(j.estimatedGrams)} est.`}</span>
          {j.status === "PRINTING" && j.startedAt && now !== null && <span>started {dateTime(j.startedAt)}</span>}
          {j.dueDate && <span className={overdue ? "font-medium text-destructive" : undefined}>due {date(j.dueDate)}</span>}
        </div>
        {j.failureReason && <p className="text-xs text-destructive">{j.failureReason}</p>}
        <div className="flex flex-wrap gap-1.5">
          {j.status === "QUEUED" && (
            <Button size="sm" onClick={() => start(j)} loading={busy === j.id}>
              <Play /> Start
            </Button>
          )}
          {j.status === "PRINTING" && (
            <>
              <Button size="sm" onClick={() => setDialog({ kind: "finish", job: j, outcome: "DONE" })}>
                <CheckCircle2 /> Finish
              </Button>
              <Button size="sm" variant="danger-ghost" onClick={() => setDialog({ kind: "finish", job: j, outcome: "FAILED" })}>
                <X /> Failed
              </Button>
            </>
          )}
          {(j.status === "POST_PROCESSING" || j.status === "QUALITY_CHECK") && (
            <>
              <Button size="sm" onClick={() => setDialog({ kind: "advance", job: j, to: "DONE" })}>
                <CheckCircle2 /> Passed QC
              </Button>
              {j.status === "POST_PROCESSING" && (
                <Button size="sm" variant="secondary" onClick={() => run(j.id, () => advanceJobAction(j.id, JSON.stringify({ to: "QUALITY_CHECK" })))}>
                  To QC
                </Button>
              )}
              <Button size="sm" variant="danger-ghost" onClick={() => setDialog({ kind: "advance", job: j, to: "FAILED" })}>
                <X /> Reject
              </Button>
            </>
          )}
          {(j.status === "FAILED" || (j.status === "DONE" && j.items.some((i) => (i.quantityGood ?? i.quantity) < i.quantity))) && !j.hasReprint && (
            <Button size="sm" variant="secondary" onClick={() => run(j.id, () => reprintAction(j.id))} loading={busy === j.id}>
              <RotateCcw /> Reprint
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <div role="tablist" aria-label="View" className="mb-4 inline-flex rounded-lg bg-muted p-1">
        {(["board", "queues"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", view === v ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {v === "board" ? "Board" : "Printer queues"}
          </button>
        ))}
      </div>

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <div className="grid min-w-[1100px] grid-cols-6 gap-3">
            {COLUMNS.map((col) => {
              const list = jobs.filter((j) => j.status === col);
              return (
                <section
                  key={col}
                  aria-label={enumLabel("jobStatus", col)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const job = jobs.find((j) => j.id === e.dataTransfer.getData("text/plain"));
                    if (job) moveTo(job, col);
                  }}
                  className="flex min-h-64 flex-col gap-2 rounded-xl bg-muted/60 p-2"
                >
                  <header className="flex items-center justify-between px-1 py-1">
                    <Badge tone={JOB_STATUS_TONE[col]}>{enumLabel("jobStatus", col)}</Badge>
                    <span className="tabular text-xs text-muted-foreground">
                      {list.length}
                      {(col === "DONE" || col === "FAILED") && " · 7 days"}
                    </span>
                  </header>
                  {list.map((j) => card(j))}
                  {list.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Drop here</p>}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[...printers, { id: "", name: "Unassigned", status: "" }].map((p) => {
            const printing = jobs.filter((j) => j.status === "PRINTING" && (j.printerId ?? "") === p.id);
            const queued = jobs.filter((j) => j.status === "QUEUED" && (j.printerId ?? "") === p.id).sort((a, b) => a.queuePosition - b.queuePosition);
            if (!p.id && queued.length === 0) return null;
            // Sequential ETA from now using estimates.
            const base = now ?? 0;
            let cursor = base + printing.reduce((a, j) => a + Math.max(0, Number(j.estimatedMinutes ?? 0) * 60000 - (j.startedAt ? base - new Date(j.startedAt).getTime() : 0)), 0);
            return (
              <section key={p.id || "none"} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
                <header className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.status && <Badge tone={p.status === "AVAILABLE" ? "success" : p.status === "PRINTING" ? "primary" : "warning"}>{enumLabel("printerStatus", p.status)}</Badge>}
                </header>
                <div className="grid gap-2">
                  {printing.map((j) => card(j, true))}
                  {queued.map((j, idx) => {
                    const eta = new Date(cursor);
                    cursor += Number(j.estimatedMinutes ?? 0) * 60000;
                    return (
                      <div key={j.id} className="grid gap-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            #{idx + 1}
                            {now !== null && <> · starts ≈ {new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: APP_TZ }).format(eta)}</>}
                          </span>
                          {p.id && (
                            <span className="flex gap-0.5">
                              <Button size="icon-sm" variant="ghost" aria-label={`Move ${j.number} up`} disabled={idx === 0} onClick={() => run(j.id, () => reorderJobAction(j.id, "up"))}>
                                <ArrowUp />
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label={`Move ${j.number} down`} disabled={idx === queued.length - 1} onClick={() => run(j.id, () => reorderJobAction(j.id, "down"))}>
                                <ArrowDown />
                              </Button>
                            </span>
                          )}
                        </div>
                        {card(j, true)}
                      </div>
                    );
                  })}
                  {printing.length === 0 && queued.length === 0 && <p className="text-sm text-muted-foreground">Idle — nothing queued.</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {dialog?.kind === "finish" && <FinishDialog job={dialog.job} outcome={dialog.outcome} spools={spools} onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} />}
      {dialog?.kind === "advance" && <AdvanceDialog job={dialog.job} to={dialog.to} onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} />}
      {dialog?.kind === "start" && (
        <StartDialog
          job={dialog.job}
          printers={printers}
          onClose={() => setDialog(null)}
          onStart={async (pid) => {
            if (await run(dialog.job.id, () => startJobAction(dialog.job.id, pid))) setDialog(null);
          }}
        />
      )}
    </>
  );
}

function JobMenu({ job, printers, onCancel, onReprint, onUndo, onAssign }: { job: BoardJob; printers: Printer[]; onCancel: () => void; onReprint: () => void; onUndo: () => void; onAssign: (pid: string | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${job.number}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {job.status === "QUEUED" &&
          printers.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onAssign(p.id)} disabled={p.id === job.printerId}>
              <Plus /> Assign to {p.name}
            </DropdownMenuItem>
          ))}
        {job.status === "PRINTING" && (
          <DropdownMenuItem onSelect={onUndo}>
            <Undo2 /> Undo start
          </DropdownMenuItem>
        )}
        {(job.status === "FAILED" || job.status === "DONE") && !job.hasReprint && (
          <DropdownMenuItem onSelect={onReprint}>
            <RotateCcw /> Reprint
          </DropdownMenuItem>
        )}
        {job.status === "QUEUED" && (
          <DropdownMenuItem danger onSelect={onCancel}>
            <Trash2 /> Cancel job
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href={`/orders/${job.orderId}`}>Open order {job.orderNumber}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StartDialog({ job, printers, onClose, onStart }: { job: BoardJob; printers: Printer[]; onClose: () => void; onStart: (printerId: string) => void }) {
  const available = printers.filter((p) => !["MAINTENANCE", "OFFLINE", "RETIRED"].includes(p.status));
  const [pid, setPid] = React.useState(available[0]?.id ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Start ${job.number}`} description="Choose the printer running this job.">
        <Field label="Printer">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({enumLabel("printerStatus", p.status).toLowerCase()})
              </option>
            ))}
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onStart(pid)} disabled={!pid}>
            <Play /> Start print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog({ job, outcome: initialOutcome, spools, onClose, onDone }: { job: BoardJob; outcome: string; spools: Spool[]; onClose: () => void; onDone: () => void }) {
  const materialIds = new Set([job.materialId, ...job.items.map((i) => i.materialId)].filter(Boolean) as string[]);
  const relevant = spools.filter((s) => materialIds.has(s.materialId));
  const now = useNow();
  const elapsed = job.startedAt && now ? Math.max(1, Math.round((now - new Date(job.startedAt).getTime()) / 60000)) : null;
  const [outcome, setOutcome] = React.useState(initialOutcome);
  const [minutes, setMinutes] = React.useState(String(job.estimatedMinutes ? Math.round(Number(job.estimatedMinutes)) : elapsed ?? ""));
  const [rows, setRows] = React.useState<{ spoolId: string; grams: string }[]>([{ spoolId: relevant[0]?.id ?? "", grams: job.estimatedGrams ? String(Math.round(Number(job.estimatedGrams))) : "" }]);
  const [good, setGood] = React.useState<Record<string, string>>(Object.fromEntries(job.items.map((i) => [i.id, String(i.quantity)])));
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const failed = outcome === "FAILED";

  const submit = async () => {
    setBusy(true);
    const payload = {
      outcome,
      actualMinutes: minutes || null,
      consumption: rows.filter((r) => r.grams).map((r) => ({ spoolId: r.spoolId || null, materialId: r.spoolId ? null : job.materialId, grams: r.grams })),
      good: outcome === "DONE" ? Object.fromEntries(Object.entries(good).map(([k, v]) => [k, Number(v)])) : {},
      failureReason: failed ? reason : null,
      notes: notes || null,
    };
    const r = await finishPrintAction(job.id, JSON.stringify(payload));
    setBusy(false);
    if (r.ok) {
      toast.success(failed ? "Failure recorded. Queue a reprint from the card." : "Print recorded.");
      onDone();
    } else toast.error(r.error);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={failed ? `Record failed print ${job.number}` : `Finish print ${job.number}`} description="Actual time and filament are used for inventory and actual-cost reports." wide>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Result">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="DONE">Done — parts passed</option>
                <option value="POST_PROCESSING">Needs post-processing</option>
                <option value="QUALITY_CHECK">Needs quality check</option>
                <option value="FAILED">Failed</option>
              </Select>
            </Field>
            <Field label="Actual print time (minutes)" hint={elapsed ? `Started ${elapsed} min ago` : undefined}>
              <Input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{failed ? "Filament wasted" : "Filament used"} (per spool)</legend>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
                <Select aria-label="Spool" value={r.spoolId} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, spoolId: e.target.value } : x)))}>
                  <option value="">No spool tracked (material only)</option>
                  {relevant.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.label} · {s.measured ? "" : "≈"}
                      {Math.round(Number(s.remainingG))} g left
                    </option>
                  ))}
                </Select>
                <div className="relative">
                  <Input aria-label="Grams" inputMode="decimal" value={r.grams} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, grams: e.target.value } : x)))} className="pe-7" />
                  <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-xs text-muted-foreground">g</span>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => setRows(rows.filter((_, k) => k !== i))} disabled={rows.length === 1}>
                  <Ban />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setRows([...rows, { spoolId: "", grams: "" }])}>
              <Plus /> Another spool (e.g. multi-color / AMS)
            </Button>
            {relevant.length === 0 && <p className="text-xs text-warning">No spools in stock for this material — usage is recorded against the material without a spool.</p>}
          </fieldset>
          {outcome === "DONE" && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Good units</legend>
              {job.items.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`good-${i.id}`}>{i.partName}</Label>
                  <div className="flex items-center gap-2">
                    <Input id={`good-${i.id}`} inputMode="numeric" className="w-20" value={good[i.id]} onChange={(e) => setGood({ ...good, [i.id]: e.target.value.replace(/\D/g, "") })} />
                    <span className="text-muted-foreground">/ {i.quantity}</span>
                  </div>
                </div>
              ))}
            </fieldset>
          )}
          {failed && (
            <Field label="What went wrong?" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Warping, spaghetti, clog…" />
            </Field>
          )}
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={failed ? "danger" : "primary"} loading={busy} disabled={failed && reason.trim().length < 3} onClick={submit}>
            {failed ? "Record failure" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({ job, to, onClose, onDone }: { job: BoardJob; to: string; onClose: () => void; onDone: () => void }) {
  const [good, setGood] = React.useState<Record<string, string>>(Object.fromEntries(job.items.map((i) => [i.id, String(i.quantity)])));
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const failed = to === "FAILED";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={failed ? `Reject parts of ${job.number}` : `Quality check passed — ${job.number}`} description={failed ? "All parts of this job are scrapped. Queue a reprint afterwards." : "Record how many units are good. Rejected units can be reprinted."}>
        <div className="grid gap-3">
          {!failed &&
            job.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                <Label htmlFor={`g-${i.id}`}>{i.partName}</Label>
                <div className="flex items-center gap-2">
                  <Input id={`g-${i.id}`} inputMode="numeric" className="w-20" value={good[i.id]} onChange={(e) => setGood({ ...good, [i.id]: e.target.value.replace(/\D/g, "") })} />
                  <span className="text-muted-foreground">/ {i.quantity}</span>
                </div>
              </div>
            ))}
          {failed && (
            <Field label="Reason" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          )}
          <Field label="QC notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={failed ? "danger" : "primary"}
            loading={busy}
            disabled={failed && reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              const r = await advanceJobAction(job.id, JSON.stringify({ to, good: Object.fromEntries(Object.entries(good).map(([k, v]) => [k, Number(v)])), qcNotes: notes || null, failureReason: failed ? reason : null }));
              setBusy(false);
              if (r.ok) {
                toast.success("Job updated.");
                onDone();
              } else toast.error(r.error);
            }}
          >
            {failed ? "Reject parts" : "Mark done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
