"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Copy, Info, Layers, MoreVertical, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { requiresModeling, requiresPrint, requiresScanning } from "@/domain/pricing/engine";
import { formatMinutes, parseDurationToMinutes } from "@/domain/pricing/from-form";
import type { LineResult } from "@/domain/pricing/types";
import { SERVICE_TYPES } from "@/domain/schemas/sales";
import type { EditorOptions } from "@/server/services/editor";
import { enumLabel } from "@/lib/labels";
import { grams, money, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EditorLine } from "./types";
import { SlicerImport, type SlicerImportPatch } from "./slicer-import";

type Update = (patch: Partial<EditorLine>) => void;

function Num({
  label,
  value,
  onChange,
  suffix,
  id,
  invalid,
  placeholder,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  id: string;
  invalid?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          className={cn("tabular", suffix && "pe-10")}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Txt({
  label,
  value,
  onChange,
  id,
  placeholder,
  className,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  id: string;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function LineCard({
  index,
  line,
  result,
  options,
  customerId,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
  serverErrors,
  canRemove,
  locked,
}: {
  index: number;
  line: EditorLine;
  result: LineResult;
  options: EditorOptions;
  customerId: string | null;
  onUpdate: Update;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  serverErrors: Record<string, string>;
  canRemove: boolean;
  locked?: string | null;
}) {
  const [breakdown, setBreakdown] = React.useState(false);
  const idp = `l${line.key}`;
  const print = requiresPrint(line.serviceType);
  const modeling = requiresModeling(line.serviceType);
  const scanning = requiresScanning(line.serviceType);
  const errFields = new Set(result.issues.filter((i) => i.severity === "error").map((i) => i.field));
  const materialOpts = React.useMemo(() => {
    const opts = options.materials.map((m) => ({
      value: m.id,
      label: m.label,
      swatch: m.colorHex,
      hint: `${m.pricePerKg ? `${money(m.pricePerKg)}/kg` : "no price!"} · ${grams(m.availableG)} available`,
    }));
    const snap = line.resolved.material;
    if (snap && !opts.some((o) => o.value === snap.id))
      opts.unshift({
        value: snap.id,
        label: `${snap.label} (inactive)`,
        swatch: null,
        hint: `snapshot ${snap.pricePerKg ?? "?"}/kg`,
      });
    return opts;
  }, [options.materials, line.resolved.material]);
  const selectedMaterial = options.materials.find((m) => m.id === line.materialId);
  const printerOpts = options.printers.map((p) => ({
    value: p.id,
    label: p.name,
    hint: `${p.model}${selectedMaterial && p.materialTypes.length && !p.materialTypes.includes(selectedMaterial.typeCode) ? ` · does not list ${selectedMaterial.typeCode}` : ""}`,
  }));
  const designs = options.designs.filter((d) => !customerId || d.customerId === customerId);
  const printMinutes = parseDurationToMinutes(line.printTime);
  const snapshotDiffers = !!(line.resolved.material && selectedMaterial && line.resolved.material.pricePerKg !== selectedMaterial.pricePerKg);

  const setMaterial = (id: string | null) => {
    const m = options.materials.find((x) => x.id === id);
    onUpdate({
      materialId: id,
      resolved: {
        ...line.resolved,
        material: m
          ? {
              id: m.id,
              label: m.label,
              pricePerKg: m.pricePerKg,
              wastePercent: m.wastePercent,
            }
          : null,
      },
    });
  };
  const setSupportMaterial = (id: string | null) => {
    const m = options.materials.find((x) => x.id === id);
    onUpdate({
      supportMaterialId: id,
      resolved: {
        ...line.resolved,
        supportMaterial: m
          ? {
              id: m.id,
              label: m.label,
              pricePerKg: m.pricePerKg,
              wastePercent: m.wastePercent,
            }
          : null,
      },
    });
  };
  const setPrinter = (id: string | null) => {
    const p = options.printers.find((x) => x.id === id);
    onUpdate({
      printerId: id,
      resolved: { ...line.resolved, printer: p ? p.resolved : null },
    });
  };
  const loadDesign = (id: string | null) => {
    const d = options.designs.find((x) => x.id === id);
    if (!d) return onUpdate({ designProjectId: null });
    const m = options.materials.find((x) => x.id === d.defaultMaterialId);
    const p = options.printers.find((x) => x.id === d.defaultPrinterId);
    onUpdate({
      designProjectId: d.id,
      partName: line.partName || d.title,
      serviceType: line.serviceType === "MODELING_AND_PRINTING" || line.serviceType === "PRINT_ONLY" ? line.serviceType : "PRINT_ONLY",
      designFeeWaived: line.serviceType === "MODELING_AND_PRINTING" ? true : line.designFeeWaived,
      waivedReason: line.waivedReason || `Re-order of ${d.number}`,
      materialId: m?.id ?? line.materialId,
      printerId: p?.id ?? line.printerId,
      gramsPerUnit: d.defaultGramsPerUnit ?? line.gramsPerUnit,
      supportGramsPerUnit: d.defaultSupportGrams ?? line.supportGramsPerUnit,
      printTime: d.defaultPrintMinutes ? formatMinutes(d.defaultPrintMinutes) : line.printTime,
      resolved: {
        ...line.resolved,
        material: m
          ? {
              id: m.id,
              label: m.label,
              pricePerKg: m.pricePerKg,
              wastePercent: m.wastePercent,
            }
          : line.resolved.material,
        printer: p ? p.resolved : line.resolved.printer,
      },
    });
  };

  const applySlicer = (p: SlicerImportPatch) => {
    const m = p.materialId ? options.materials.find((x) => x.id === p.materialId) : null;
    onUpdate({
      gramsPerUnit: p.gramsPerUnit,
      printTime: formatMinutes(p.printMinutesPerUnit),
      unitsPerBatch: String(p.unitsPerBatch),
      // The slicer's plate weight already includes supports and purge.
      supportGramsPerUnit: "",
      purgeGramsPerBatch: "",
      partName: line.partName || p.partName || "",
      ...(m
        ? {
            materialId: m.id,
            resolved: {
              ...line.resolved,
              material: {
                id: m.id,
                label: m.label,
                pricePerKg: m.pricePerKg,
                wastePercent: m.wastePercent,
              },
            },
          }
        : {}),
    });
    toast.success("Slicer data applied — review the price.");
  };

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  return (
    <section aria-label={`Item ${index + 1}`} className={cn("rounded-xl border bg-card shadow-[var(--shadow-card)]", errors.length ? "border-destructive/40" : "border-border")}>
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_200px_90px]">
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-name`} className="text-xs text-muted-foreground">
              Part name
            </Label>
            <Input
              id={`${idp}-name`}
              value={line.partName}
              onChange={(e) => onUpdate({ partName: e.target.value })}
              placeholder="e.g. Phone stand"
              aria-invalid={!!serverErrors.partName || undefined}
              data-autofocus-line
            />
            {serverErrors.partName && <p className="text-xs text-destructive">{serverErrors.partName}</p>}
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-svc`} className="text-xs text-muted-foreground">
              Service
            </Label>
            <Select
              id={`${idp}-svc`}
              value={line.serviceType}
              disabled={!!locked}
              onChange={(e) =>
                onUpdate({
                  serviceType: e.target.value as EditorLine["serviceType"],
                  quantity: ["MODELING_ONLY", "SCANNING_ONLY"].includes(e.target.value) ? "1" : line.quantity,
                })
              }
            >
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel("serviceType", s)}
                </option>
              ))}
            </Select>
          </div>
          <Num id={`${idp}-qty`} label="Quantity" value={line.quantity} onChange={(v) => onUpdate({ quantity: v.replace(/[^\d]/g, "") })} invalid={errFields.has("quantity")} />
        </div>
        <div className="flex items-center gap-1 sm:mt-5">
          <div className="me-2 hidden text-end sm:block">
            <p className="tabular text-sm font-semibold">{result.net ? money(result.net) : "—"}</p>
            <p className="text-[11px] text-muted-foreground">{result.production ? `${money(result.production.unitPrice)} / unit` : "line total"}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setBreakdown(true)} aria-label="Show price breakdown" title="Price breakdown">
            <Info />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for item ${index + 1}`}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(-1)}>
                <ChevronUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(1)}>
                <ChevronDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuItem danger disabled={!canRemove} onSelect={onRemove}>
                <Trash2 /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4">
        {locked && <p className="text-xs text-muted-foreground">{locked}</p>}
        {print && (
          <div className="grid gap-2">
            <div className="-mt-1 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Printing</p>
              <SlicerImport materials={options.materials} currentMaterialId={line.materialId} onApply={applySlicer} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_repeat(3,minmax(0,0.8fr))]">
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={`${idp}-mat`} className="text-xs text-muted-foreground">
                  Material
                </Label>
                <Combobox
                  id={`${idp}-mat`}
                  options={materialOpts}
                  value={line.materialId}
                  onChange={setMaterial}
                  placeholder="Choose filament…"
                  searchPlaceholder="Type, brand, color…"
                  invalid={errFields.has("materialId")}
                  footer={
                    <Link href="/materials/new" target="_blank" className="block rounded-md px-2.5 py-2 text-xs text-primary hover:bg-accent">
                      + New material (opens new tab)
                    </Link>
                  }
                />
                {snapshotDiffers && (
                  <p className="text-[11px] text-warning">
                    Priced at the saved {line.resolved.material?.pricePerKg}/kg (current {selectedMaterial?.pricePerKg}/kg).
                  </p>
                )}
              </div>
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={`${idp}-prn`} className="text-xs text-muted-foreground">
                  Printer
                </Label>
                <Combobox id={`${idp}-prn`} options={printerOpts} value={line.printerId} onChange={setPrinter} placeholder="Choose printer…" allowClear />
              </div>
              <Num id={`${idp}-g`} label="Grams / unit" value={line.gramsPerUnit} onChange={(v) => onUpdate({ gramsPerUnit: v })} suffix="g" invalid={errFields.has("gramsPerUnit")} />
              <div className="grid min-w-0 content-start gap-1">
                <Label htmlFor={`${idp}-t`} className="text-xs text-muted-foreground">
                  Print time / unit
                </Label>
                <Input
                  id={`${idp}-t`}
                  value={line.printTime}
                  onChange={(e) => onUpdate({ printTime: e.target.value })}
                  onBlur={() => printMinutes !== null && onUpdate({ printTime: formatMinutes(printMinutes) })}
                  placeholder="2h 30m"
                  aria-invalid={errFields.has("printMinutesPerUnit") || (line.printTime !== "" && printMinutes === null) || undefined}
                />
                {line.printTime !== "" && printMinutes === null && <p className="text-[11px] text-destructive">Use e.g. 95, 1:35 or 1h 35m</p>}
              </div>
              <Num
                id={`${idp}-b`}
                label="Units / plate"
                value={line.unitsPerBatch}
                onChange={(v) => onUpdate({ unitsPerBatch: v.replace(/[^\d]/g, "") })}
                hint={result.production ? `${result.production.batches} plate(s)` : undefined}
              />
            </div>
          </div>
        )}

        {modeling && (
          <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-[140px_1fr_1fr_1.4fr]">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-mm`} className="text-xs text-muted-foreground">
                Modeling charge
              </Label>
              <Select
                id={`${idp}-mm`}
                value={line.modelingMode}
                onChange={(e) =>
                  onUpdate({
                    modelingMode: e.target.value as "HOURLY" | "FIXED",
                  })
                }
                disabled={line.designFeeWaived}
              >
                <option value="HOURLY">Hourly</option>
                <option value="FIXED">Fixed fee</option>
              </Select>
            </div>
            <Num
              id={`${idp}-mh`}
              label={line.modelingMode === "HOURLY" ? "Estimated hours" : "Est. hours (for cost)"}
              value={line.modelingHours}
              onChange={(v) => onUpdate({ modelingHours: v })}
              suffix="h"
              invalid={errFields.has("modelingHours")}
            />
            {line.modelingMode === "FIXED" ? (
              <Num id={`${idp}-mf`} label="Fixed fee" value={line.modelingFee} onChange={(v) => onUpdate({ modelingFee: v })} suffix="₪" invalid={errFields.has("modelingFee")} />
            ) : (
              <div className="grid content-end pb-2 text-xs text-muted-foreground">{result.services.modeling ? `${money(result.services.modeling.price)} one-time` : "One-time, not × quantity"}</div>
            )}
            <div className="grid content-end gap-1">
              <Checkbox checked={line.designFeeWaived} onChange={(e) => onUpdate({ designFeeWaived: e.target.checked })} label="Design fee already paid" hint="Re-order of an existing design" />
            </div>
          </div>
        )}

        {scanning && (
          <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-3">
            <Num id={`${idp}-sh`} label="Scanning" value={line.scanHours} onChange={(v) => onUpdate({ scanHours: v })} suffix="h" invalid={errFields.has("scanHours")} />
            <Num id={`${idp}-sc`} label="Scan cleanup" value={line.scanCleanupHours} onChange={(v) => onUpdate({ scanCleanupHours: v })} suffix="h" />
            <Num id={`${idp}-sr`} label="Reverse engineering" value={line.reverseEngineeringHours} onChange={(v) => onUpdate({ reverseEngineeringHours: v })} suffix="h" />
          </div>
        )}

        <button
          type="button"
          onClick={() => onUpdate({ expanded: !line.expanded })}
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          aria-expanded={line.expanded}
        >
          {line.expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} {line.expanded ? "Fewer options" : "More options"} — {print ? "support, post-processing, " : ""}
          discount, deadline, notes
        </button>

        {line.expanded && (
          <div className="grid gap-4 border-t border-dashed border-border pt-4">
            {print && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Num id={`${idp}-sg`} label="Support / unit" value={line.supportGramsPerUnit} onChange={(v) => onUpdate({ supportGramsPerUnit: v })} suffix="g" />
                <div className="grid min-w-0 gap-1 sm:col-span-2">
                  <Label htmlFor={`${idp}-sm`} className="text-xs text-muted-foreground">
                    Support material
                  </Label>
                  <Combobox id={`${idp}-sm`} options={materialOpts} value={line.supportMaterialId} onChange={setSupportMaterial} placeholder="Same as part" allowClear />
                </div>
                <Num id={`${idp}-pg`} label="Purge / plate" value={line.purgeGramsPerBatch} onChange={(v) => onUpdate({ purgeGramsPerBatch: v })} suffix="g" hint="AMS color changes" />
                <Num id={`${idp}-su`} label="Setup / plate" value={line.setupMinutesPerBatch} onChange={(v) => onUpdate({ setupMinutesPerBatch: v })} suffix="min" placeholder="default" />
                <Num id={`${idp}-pp`} label="Post-process / unit" value={line.postProcessMinutesPerUnit} onChange={(v) => onUpdate({ postProcessMinutesPerUnit: v })} suffix="min" />
                <Num id={`${idp}-ex`} label="Extra cost / unit" value={line.extraCostPerUnit} onChange={(v) => onUpdate({ extraCostPerUnit: v })} suffix="₪" hint="Inserts, magnets…" />
                <Txt id={`${idp}-exn`} label="Extra cost note" value={line.extraCostNote} onChange={(v) => onUpdate({ extraCostNote: v })} className="sm:col-span-2" />
                <Txt id={`${idp}-col`} label="Color / finish note" value={line.colorNote} onChange={(v) => onUpdate({ colorNote: v })} placeholder="Matte black, sanded" className="sm:col-span-3" />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="grid gap-1">
                <Label htmlFor={`${idp}-dt`} className="text-xs text-muted-foreground">
                  Line discount
                </Label>
                <Select
                  id={`${idp}-dt`}
                  value={line.discountType}
                  onChange={(e) =>
                    onUpdate({
                      discountType: e.target.value as EditorLine["discountType"],
                    })
                  }
                >
                  <option value="">None</option>
                  <option value="PERCENT">Percent</option>
                  <option value="AMOUNT">Amount</option>
                </Select>
              </div>
              {line.discountType && (
                <Num
                  id={`${idp}-dv`}
                  label="Discount"
                  value={line.discountValue}
                  onChange={(v) => onUpdate({ discountValue: v })}
                  suffix={line.discountType === "PERCENT" ? "%" : "₪"}
                  invalid={errFields.has("discount")}
                />
              )}
              {print && (
                <>
                  <Num
                    id={`${idp}-mu`}
                    label="Manual unit price"
                    value={line.manualUnitPrice}
                    onChange={(v) => onUpdate({ manualUnitPrice: v })}
                    suffix="₪"
                    placeholder={result.production?.suggestedUnitPrice ?? ""}
                    invalid={errFields.has("manualUnitPrice")}
                  />
                  {line.manualUnitPrice && (
                    <div className="grid gap-1 sm:col-span-2">
                      <Label htmlFor={`${idp}-mr`} className="text-xs text-muted-foreground">
                        Override reason (required)
                      </Label>
                      <Input
                        id={`${idp}-mr`}
                        value={line.manualPriceReason}
                        onChange={(e) => onUpdate({ manualPriceReason: e.target.value })}
                        aria-invalid={errFields.has("manualPriceReason") || undefined}
                        placeholder="Price agreed by phone"
                      />
                    </div>
                  )}
                </>
              )}
              <Txt id={`${idp}-dl`} label="Item deadline" type="date" value={line.deadline} onChange={(v) => onUpdate({ deadline: v })} />
              <Txt id={`${idp}-cat`} label="Category" value={line.category} onChange={(v) => onUpdate({ category: v })} placeholder="Spare parts" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor={`${idp}-desc`} className="text-xs text-muted-foreground">
                  Description (shown to customer)
                </Label>
                <Textarea id={`${idp}-desc`} rows={2} value={line.description} onChange={(e) => onUpdate({ description: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${idp}-si`} className="text-xs text-muted-foreground">
                  Special instructions (shown to customer)
                </Label>
                <Textarea id={`${idp}-si`} rows={2} value={line.specialInstructions} onChange={(e) => onUpdate({ specialInstructions: e.target.value })} />
              </div>
            </div>
            {designs.length > 0 && (
              <div className="grid gap-1 sm:max-w-md">
                <Label className="text-xs text-muted-foreground">Re-order an existing design</Label>
                <Combobox
                  options={designs.map((d) => ({
                    value: d.id,
                    label: `${d.number} — ${d.title}`,
                    hint: enumLabel("designStatus", d.status),
                  }))}
                  value={line.designProjectId}
                  onChange={loadDesign}
                  placeholder="Link a design (fills print settings)"
                  allowClear
                />
              </div>
            )}
          </div>
        )}

        {(errors.length > 0 || warnings.length > 0 || infos.length > 0) && (
          <ul className="grid gap-1 text-xs" aria-live="polite">
            {errors.map((i, k) => (
              <li key={`e${k}`} className="flex items-start gap-1.5 text-destructive">
                <TriangleAlert className="mt-px size-3.5 shrink-0" /> {i.message}
              </li>
            ))}
            {warnings.map((i, k) => (
              <li key={`w${k}`} className="flex items-start gap-1.5 text-warning">
                <TriangleAlert className="mt-px size-3.5 shrink-0" /> {i.message}
              </li>
            ))}
            {infos.map((i, k) => (
              <li key={`i${k}`} className="flex items-start gap-1.5 text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" /> {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-3">
          {result.production && (
            <>
              <span>
                <Layers className="me-1 inline size-3" />
                {grams(result.production.grams.total)} · {formatMinutes(Number(result.production.machineHours) * 60)} machine
              </span>
            </>
          )}
          {result.cost && <span>Cost {money(result.cost)}</span>}
          {result.marginPercent && <span className={Number(result.marginPercent) < 0.2 ? "text-warning" : undefined}>Margin {percent(result.marginPercent)}</span>}
          {result.production?.priceSource === "MANUAL" && <Badge tone="warning">manual price</Badge>}
        </span>
        <span className="tabular font-medium text-foreground sm:hidden">{result.net ? money(result.net) : "incomplete"}</span>
      </div>

      <Dialog open={breakdown} onOpenChange={setBreakdown}>
        <DialogContent
          title={`How “${line.partName || `Item ${index + 1}`}” is priced`}
          description="Every number, the formula that produced it, and the rounding applied. Internal — never shown to customers."
          wide
        >
          {result.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Complete the required fields to see the breakdown.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {result.steps.map((s, k) => (
                  <tr key={k}>
                    <td className="py-2 pe-3 font-medium">{s.label}</td>
                    <td className="py-2 pe-3 font-mono text-xs text-muted-foreground">{s.formula}</td>
                    <td className="tabular py-2 text-end">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.net && (
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Customer price</p>
                <p className="tabular font-semibold">{money(result.net)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estimated cost</p>
                <p className="tabular font-semibold">{money(result.cost)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gross margin</p>
                <p className="tabular font-semibold">{percent(result.marginPercent)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Markup on cost</p>
                <p className="tabular font-semibold">{percent(result.markupPercent)}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
