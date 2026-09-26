"use client";
import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/form";
import { Alert, Badge } from "@/components/ui/misc";
import type { Bambu3mfResult, SlicePlate } from "@/domain/slicer/bambu-3mf";
import type { EditorOptions } from "@/server/services/editor";
import { grams, minutesToHuman } from "@/lib/format";
import { cn } from "@/lib/utils";

type Parser = typeof import("@/domain/slicer/bambu-3mf");

export interface SlicerImportPatch {
  gramsPerUnit: string;
  printMinutesPerUnit: number;
  unitsPerBatch: number;
  materialId: string | null;
  partName: string | null;
}

/**
 * Fills a line's grams, print time and units per plate from a Bambu Studio / OrcaSlicer 3MF.
 * The file is read in the browser only — it is not uploaded — and nothing changes until the
 * user reviews the numbers and presses Apply. Manual entry always remains available.
 */
export function SlicerImport({ materials, currentMaterialId, onApply }: { materials: EditorOptions["materials"]; currentMaterialId: string | null; onApply: (patch: SlicerImportPatch) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [parser, setParser] = React.useState<Parser | null>(null);
  const [result, setResult] = React.useState<Bambu3mfResult | null>(null);
  const [thumbs, setThumbs] = React.useState<Record<number, string>>({});
  const [plateIndex, setPlateIndex] = React.useState(1);
  const [units, setUnits] = React.useState("1");
  const [materialId, setMaterialId] = React.useState<string>("");

  const clearThumbs = React.useCallback(() => {
    setThumbs((t) => {
      Object.values(t).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
  }, []);
  React.useEffect(() => clearThumbs, [clearThumbs]);

  const selectPlate = (p: Parser, plate: SlicePlate) => {
    setPlateIndex(plate.index);
    setUnits(String(p.defaultUnitsOnPlate(plate)));
    const match = p.matchMaterial(p.primaryFilament(plate), materials);
    setMaterialId(match?.material.id ?? "");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    clearThumbs();
    setFileName(file.name);
    try {
      const p = await import("@/domain/slicer/bambu-3mf");
      const res = await p.readBambu3mf(await file.arrayBuffer(), {
        thumbnails: true,
      });
      setParser(p);
      setResult(res);
      if (res.ok) {
        setThumbs(Object.fromEntries(Object.entries(res.thumbnails).map(([i, png]) => [i, URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }))])));
        selectPlate(p, res.info.plates[0]);
      }
    } catch {
      setResult({
        ok: false,
        reason: "MALFORMED",
        message: "The file could not be read.",
      });
    } finally {
      setBusy(false);
      setOpen(true);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const plate = result?.ok ? (result.info.plates.find((pl) => pl.index === plateIndex) ?? result.info.plates[0]) : null;
  const unitsNum = /^\d+$/.test(units) ? Number(units) : NaN;
  const suggestion = parser && plate ? parser.suggestFromPlate(plate, unitsNum) : null;
  const groups = parser && plate ? parser.plateObjectGroups(plate) : [];
  const usedFilaments = plate?.filaments.filter((f) => f.usedG !== null && Number(f.usedG) > 0) ?? [];
  const primary = parser && plate ? parser.primaryFilament(plate) : null;
  const match = parser && plate ? parser.matchMaterial(primary, materials) : null;

  const apply = () => {
    if (!suggestion?.ok) return;
    onApply({
      gramsPerUnit: suggestion.gramsPerUnit,
      printMinutesPerUnit: suggestion.printMinutesPerUnit,
      unitsPerBatch: suggestion.unitsPerBatch,
      materialId: materialId || null,
      partName: groups.length === 1 ? groups[0].name : null,
    });
    setOpen(false);
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".3mf" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="slicer-file" />
      <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Import from slicer (.3mf)
      </Button>
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || clearThumbs())}>
        <DialogContent title="Import from Bambu Studio / OrcaSlicer" description={<span className="break-all">{fileName}</span>} wide>
          {result && !result.ok ? (
            <div className="grid gap-3">
              <Alert tone="warning" title="No usable slicing data">
                {result.message}
              </Alert>
              <p className="text-sm text-muted-foreground">Nothing was changed. You can still type grams and print time into the item manually.</p>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : result?.ok && plate ? (
            <div className="grid gap-4">
              <p className="text-xs text-muted-foreground">
                {[
                  result.info.clientVersion && `Slicer version ${result.info.clientVersion}`,
                  result.project?.printerModel ?? (plate.printerModelId && `Printer model ${plate.printerModelId}`),
                  result.project?.layerHeight && `${result.project.layerHeight} mm layers`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Bambu Studio / OrcaSlicer format"}
                {" · read on this device, not uploaded"}
              </p>

              {result.info.plates.length > 1 && (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Plate</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {result.info.plates.map((pl) => (
                      <label
                        key={pl.index}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm",
                          pl.index === plate.index ? "border-primary bg-primary-soft" : "border-border hover:bg-accent",
                        )}
                      >
                        <input type="radio" name="plate" className="sr-only" checked={pl.index === plate.index} onChange={() => parser && selectPlate(parser, pl)} />
                        {thumbs[pl.index] ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                          <img src={thumbs[pl.index]} alt="" className="size-12 shrink-0 rounded bg-muted object-contain" />
                        ) : (
                          <span className="size-12 shrink-0 rounded bg-muted" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium">Plate {pl.index}</span>
                          <span className="block text-xs text-muted-foreground tabular">
                            {pl.printSeconds ? minutesToHuman(pl.printSeconds / 60) : "no time"} · {parser?.plateGrams(pl) ? grams(parser.plateGrams(pl)!) : "no weight"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="grid gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {result.info.plates.length === 1 && thumbs[plate.index] && (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img src={thumbs[plate.index]} alt={`Plate ${plate.index} preview`} className="size-16 rounded bg-background object-contain" />
                  )}
                  <div className="grid gap-0.5">
                    <p className="font-medium">
                      Plate {plate.index}: {plate.printSeconds ? minutesToHuman(plate.printSeconds / 60) : "no time estimate"} ·{" "}
                      {parser?.plateGrams(plate) ? grams(parser.plateGrams(plate)!) : "no weight"}
                    </p>
                    <p className="text-xs text-muted-foreground">{groups.length ? groups.map((g) => `${g.count}× ${g.name}`).join(", ") : "Object list not stored by this slicer version"}</p>
                  </div>
                </div>
                {usedFilaments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {usedFilaments.map((f) => (
                      <Badge key={f.slot} tone="muted">
                        <span className="inline-block size-2.5 rounded-full ring-1 ring-border" style={{ background: f.color ?? "transparent" }} aria-hidden />
                        Slot {f.slot}: {f.type ?? "?"} {f.usedG ? grams(f.usedG) : ""}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="slicer-units">Finished units this plate produces</Label>
                  <Input id="slicer-units" value={units} inputMode="numeric" onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ""))} className="tabular" />
                  <p className="text-[11px] text-muted-foreground">
                    {groups.length > 1 ? "The plate holds different parts — if they form one product, keep 1." : "Weight and time are split evenly across these units."}
                  </p>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="slicer-material">Material</Label>
                  <Select id="slicer-material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                    <option value="">{currentMaterialId ? "Keep the item's current material" : "Choose later"}</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {primary?.type
                      ? match
                        ? match.exact
                          ? `Matches the slicer's ${primary.type} ${primary.color ?? ""}.`
                          : `Only ${primary.type} in stock — check the colour.`
                        : `No ${primary.type} material matches the slicer's filament.`
                      : "The file does not name the filament type."}
                  </p>
                </div>
              </div>

              {suggestion &&
                (suggestion.ok ? (
                  <div className="grid gap-1 rounded-lg border border-border p-3 text-sm" aria-live="polite">
                    <p className="font-medium">Will set on this item</p>
                    <p className="tabular">
                      Grams / unit <strong>{suggestion.gramsPerUnit} g</strong> · Print time / unit <strong>{minutesToHuman(suggestion.printMinutesPerUnit)}</strong> · Units / plate{" "}
                      <strong>{suggestion.unitsPerBatch}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rounded up. The slicer&apos;s weight already includes supports, purge and prime tower, so Support / unit and Purge / plate are cleared to avoid counting them twice.
                    </p>
                  </div>
                ) : (
                  <Alert tone="warning">{suggestion.message}</Alert>
                ))}

              {usedFilaments.length > 1 && <Alert tone="info">This plate uses {usedFilaments.length} filaments. The quote prices the full weight at the chosen material&apos;s price per kg.</Alert>}
              {plate.warnings.length > 0 && (
                <Alert tone="warning" title="Slicer warnings">
                  <ul className="list-inside list-disc">
                    {plate.warnings.map((w, i) => (
                      <li key={i} className="break-all">
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {result.notes.map((n) => (
                <p key={n} className="text-xs text-muted-foreground">
                  {n}
                </p>
              ))}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={apply} disabled={!suggestion?.ok}>
                  Apply to item
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
