/**
 * Read slicing results from Bambu Studio / OrcaSlicer 3MF files.
 *
 * Verified against the slicers' own writer (`_add_slice_info_config_file_to_archive` in
 * src/libslic3r/Format/bbs_3mf.cpp of bambulab/BambuStudio master and v01.04.00.17, and the
 * SoftFever/OrcaSlicer fork, which writes the same keys). What those sources show:
 *
 * - `Metadata/slice_info.config` is XML: `<config><header>` with `header_item`s
 *   (`X-BBL-Client-Type`, `X-BBL-Client-Version`), then one `<plate>` per plate that has a
 *   valid slice result. Unsliced plates are not written at all.
 * - Plate `<metadata key value>`: `index` (1-based), `prediction` (whole seconds, "normal"
 *   time mode), `weight` (grams, "%.2f"; empty when the slicer had no total), `support_used`,
 *   and in newer versions `printer_model_id`, `nozzle_diameters`, `label_object_enabled`, ….
 * - `<object identify_id name skipped>`: one per printable instance (newer versions only).
 * - `<filament id type color used_m used_g …>`: per filament slot (id is 1-based);
 *   `tray_info_idx`, `used_for_object`, `used_for_support` only in newer versions.
 * - `Metadata/project_settings.config` is JSON (`save_to_json`), values are strings or
 *   string arrays. Optional here: used for context only.
 * - Plate thumbnails live at `Metadata/plate_<index>.png`.
 *
 * Nothing here talks to Bambu Lab services: the file is read locally (in the browser).
 * Anything the file does not contain is reported as missing — never guessed.
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { D } from "@/domain/money";

export const SLICE_INFO_PATH = "Metadata/slice_info.config";
export const PROJECT_SETTINGS_PATH = "Metadata/project_settings.config";
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export interface SliceFilament {
  /** 1-based filament slot as shown in the slicer. */
  slot: number;
  type: string | null;
  /** `#RRGGBB` (alpha dropped) or null. */
  color: string | null;
  usedG: string | null;
  usedM: string | null;
  /** Bambu filament preset id (e.g. GFA00), newer versions only. */
  trayInfoIdx: string | null;
  usedForSupport: boolean | null;
}

export interface SlicePlate {
  index: number;
  printSeconds: number | null;
  weightG: string | null;
  supportUsed: boolean | null;
  printerModelId: string | null;
  nozzleDiameters: string | null;
  /** Printable object instances on the plate (not written by older slicer versions). */
  objects: { name: string; skipped: boolean }[];
  filaments: SliceFilament[];
  warnings: { message: string; level: string | null; code: string | null }[];
}

export interface SliceInfo {
  clientType: string | null;
  clientVersion: string | null;
  plates: SlicePlate[];
}

export interface ProjectSummary {
  version: string | null;
  printerModel: string | null;
  printerPreset: string | null;
  processPreset: string | null;
  layerHeight: string | null;
  filamentPresets: string[];
}

export type Bambu3mfFailure = "NOT_ZIP" | "NOT_3MF" | "NO_SLICE_INFO" | "NOT_SLICED" | "TOO_LARGE" | "MALFORMED";

export type Bambu3mfResult =
  | {
      ok: true;
      info: SliceInfo;
      project: ProjectSummary | null;
      thumbnails: Record<number, Uint8Array>;
      notes: string[];
    }
  | {
      ok: false;
      reason: Bambu3mfFailure;
      message: string;
      clientVersion?: string | null;
    };

export const FAILURE_HELP: Record<Bambu3mfFailure, string> = {
  NOT_ZIP: "This file is not a 3MF archive.",
  NOT_3MF: "This archive does not look like a 3MF file.",
  NO_SLICE_INFO: "This 3MF has no slicer results (Metadata/slice_info.config is missing) — it may be a plain model export or come from another program.",
  NOT_SLICED: "This 3MF has no sliced plates. In Bambu Studio or OrcaSlicer, slice the plate and use File → Export → Export plate sliced file (Ctrl+G), then import that file.",
  TOO_LARGE: "The slicer metadata inside this file is unexpectedly large, so it was not read.",
  MALFORMED: "The slicer metadata in this file could not be read.",
};

class ReadError extends Error {
  constructor(readonly reason: Bambu3mfFailure) {
    super(reason);
  }
}

const DECIMAL_RE = /^\d+(\.\d+)?$/;

function decimalOrNull(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  if (!DECIMAL_RE.test(s)) return null;
  return new D(s).toString();
}

function boolOrNull(v: unknown): boolean | null {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeColor(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  return m ? `#${m[1].toUpperCase()}` : null;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  htmlEntities: false,
  isArray: (name) => ["plate", "metadata", "object", "filament", "warning", "header_item"].includes(name),
});

type Attrs = Record<string, unknown>;
const asArray = (v: unknown): Attrs[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Attrs[]) : []);

/** Parse the text of Metadata/slice_info.config. Throws on malformed XML or a wrong root element. */
export function parseSliceInfo(text: string): SliceInfo {
  let doc: Attrs;
  try {
    doc = xml.parse(text, true) as Attrs;
  } catch {
    throw new ReadError("MALFORMED");
  }
  const config = doc.config;
  if (config === undefined) throw new ReadError("MALFORMED");
  const root: Attrs = config && typeof config === "object" ? (config as Attrs) : {};
  const header = root.header && typeof root.header === "object" ? (root.header as Attrs) : {};
  const headerItems = new Map(asArray(header.header_item).map((h) => [String(h.key ?? ""), strOrNull(h.value)]));

  const plates: SlicePlate[] = asArray(root.plate).map((p, i) => {
    const meta = new Map(asArray(p.metadata).map((m) => [String(m.key ?? ""), m.value]));
    const index = Number(strOrNull(meta.get("index")));
    const seconds = decimalOrNull(meta.get("prediction"));
    return {
      index: Number.isInteger(index) && index > 0 ? index : i + 1,
      printSeconds: seconds !== null && Number(seconds) > 0 ? Math.round(Number(seconds)) : null,
      weightG: (() => {
        const w = decimalOrNull(meta.get("weight"));
        return w !== null && Number(w) > 0 ? w : null;
      })(),
      supportUsed: boolOrNull(meta.get("support_used")),
      printerModelId: strOrNull(meta.get("printer_model_id")),
      nozzleDiameters: strOrNull(meta.get("nozzle_diameters")),
      objects: asArray(p.object).map((o) => ({
        name: strOrNull(o.name) ?? "Unnamed object",
        skipped: o.skipped === "true",
      })),
      filaments: asArray(p.filament)
        .map((f, fi) => {
          const slot = Number(strOrNull(f.id));
          return {
            slot: Number.isInteger(slot) && slot > 0 ? slot : fi + 1,
            type: strOrNull(f.type),
            color: normalizeColor(f.color),
            usedG: decimalOrNull(f.used_g),
            usedM: decimalOrNull(f.used_m),
            trayInfoIdx: strOrNull(f.tray_info_idx),
            usedForSupport: boolOrNull(f.used_for_support),
          };
        })
        .sort((a, b) => a.slot - b.slot),
      warnings: asArray(p.warning).map((w) => ({
        message: strOrNull(w.msg) ?? "",
        level: strOrNull(w.level),
        code: strOrNull(w.error_code),
      })),
    };
  });
  plates.sort((a, b) => a.index - b.index);
  return {
    clientType: headerItems.get("X-BBL-Client-Type") ?? null,
    clientVersion: headerItems.get("X-BBL-Client-Version") ?? null,
    plates,
  };
}

/** Parse Metadata/project_settings.config (JSON). Returns null when it is absent or unreadable. */
export function parseProjectSettings(text: string): ProjectSummary | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const first = (v: unknown) => (Array.isArray(v) ? strOrNull(v[0]) : strOrNull(v));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(strOrNull).filter((x): x is string => !!x) : strOrNull(v) ? [strOrNull(v)!] : []);
  return {
    version: first(o.version),
    printerModel: first(o.printer_model),
    printerPreset: first(o.printer_settings_id),
    processPreset: first(o.print_settings_id),
    layerHeight: decimalOrNull(first(o.layer_height)),
    filamentPresets: list(o.filament_settings_id),
  };
}

function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const lower = path.toLowerCase();
  const name = Object.keys(zip.files).find((n) => n.replace(/^\/+/, "").toLowerCase() === lower);
  const entry = name ? zip.files[name] : null;
  return entry && !entry.dir ? entry : null;
}

/** Read an archive entry, refusing to inflate more than `cap` bytes (zip-bomb guard). */
function readCapped(entry: JSZip.JSZipObject, cap: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (
      entry as unknown as {
        internalStream(t: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk: Uint8Array) => {
        if (settled) return;
        total += chunk.length;
        if (total > cap) {
          settled = true;
          stream.pause();
          reject(new ReadError("TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => {
        if (settled) return;
        settled = true;
        reject(new ReadError("MALFORMED"));
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        resolve(out);
      });
    stream.resume();
  });
}

const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

/** Read a Bambu Studio / OrcaSlicer 3MF (project or `.gcode.3mf`) and return its slicing results. */
export async function readBambu3mf(data: ArrayBuffer | Uint8Array, opts: { thumbnails?: boolean } = {}): Promise<Bambu3mfResult> {
  const fail = (reason: Bambu3mfFailure, clientVersion?: string | null): Bambu3mfResult => ({
    ok: false,
    reason,
    message: FAILURE_HELP[reason],
    clientVersion,
  });
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail("NOT_ZIP");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return fail("NOT_ZIP");
  }
  if (!findEntry(zip, "[Content_Types].xml") && !findEntry(zip, "3D/3dmodel.model")) return fail("NOT_3MF");
  const sliceEntry = findEntry(zip, SLICE_INFO_PATH);
  if (!sliceEntry) return fail("NO_SLICE_INFO");

  let info: SliceInfo;
  try {
    info = parseSliceInfo(utf8(await readCapped(sliceEntry, MAX_CONFIG_BYTES)));
  } catch (e) {
    return fail(e instanceof ReadError ? e.reason : "MALFORMED");
  }
  if (info.plates.length === 0) return fail("NOT_SLICED", info.clientVersion);

  const notes: string[] = [];
  let project: ProjectSummary | null = null;
  const projectEntry = findEntry(zip, PROJECT_SETTINGS_PATH);
  if (projectEntry) {
    try {
      project = parseProjectSettings(utf8(await readCapped(projectEntry, MAX_CONFIG_BYTES)));
    } catch {
      project = null;
    }
    if (!project) notes.push("Project settings could not be read; only slice results are shown.");
  }

  const thumbnails: Record<number, Uint8Array> = {};
  if (opts.thumbnails) {
    for (const plate of info.plates) {
      const entry = findEntry(zip, `Metadata/plate_${plate.index}.png`);
      if (!entry) continue;
      try {
        const png = await readCapped(entry, MAX_THUMBNAIL_BYTES);
        if (PNG_MAGIC.every((b, i) => png[i] === b)) thumbnails[plate.index] = png;
      } catch {
        // A missing or oversized thumbnail is cosmetic; ignore it.
      }
    }
  }
  return { ok: true, info, project, thumbnails, notes };
}

export interface ObjectGroup {
  name: string;
  count: number;
}

/** Printable (not skipped) objects on a plate, grouped by name. */
export function plateObjectGroups(plate: SlicePlate): ObjectGroup[] {
  const map = new Map<string, number>();
  for (const o of plate.objects) if (!o.skipped) map.set(o.name, (map.get(o.name) ?? 0) + 1);
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * How many finished units one plate most likely produces: the instance count when every
 * printable object is a copy of the same part; otherwise 1 (a multi-part assembly), which
 * the user can change.
 */
export function defaultUnitsOnPlate(plate: SlicePlate): number {
  const groups = plateObjectGroups(plate);
  return groups.length === 1 ? groups[0].count : 1;
}

/** Total filament grams on the plate: the slicer's plate weight, or the sum of filament usage. */
export function plateGrams(plate: SlicePlate): string | null {
  if (plate.weightG) return plate.weightG;
  const used = plate.filaments.map((f) => f.usedG).filter((g): g is string => g !== null);
  if (!used.length) return null;
  const total = used.reduce((acc, g) => acc.plus(g), new D(0));
  return total.gt(0) ? total.toString() : null;
}

/** The filament with the most grams on the plate (used to suggest the line's material). */
export function primaryFilament(plate: SlicePlate): SliceFilament | null {
  let best: SliceFilament | null = null;
  for (const f of plate.filaments) {
    if (f.usedG === null || new D(f.usedG).lte(0)) continue;
    if (!best || new D(f.usedG).gt(best.usedG!)) best = f;
  }
  return best ?? plate.filaments[0] ?? null;
}

export type PlateSuggestion =
  | {
      ok: true;
      gramsPerUnit: string;
      printMinutesPerUnit: number;
      unitsPerBatch: number;
      plateGrams: string;
      plateSeconds: number;
    }
  | { ok: false; message: string };

/**
 * Per-unit production inputs from one plate. The slicer weight already includes support,
 * purge and prime tower, so grams are rounded up to 0.01 g and time up to the whole minute —
 * a slightly high estimate is safer than an underquote.
 */
export function suggestFromPlate(plate: SlicePlate, unitsOnPlate: number): PlateSuggestion {
  if (!Number.isInteger(unitsOnPlate) || unitsOnPlate < 1)
    return {
      ok: false,
      message: "Units per plate must be a whole number of at least 1.",
    };
  const grams = plateGrams(plate);
  if (!grams)
    return {
      ok: false,
      message: `Plate ${plate.index} has no filament weight in the file — enter grams manually.`,
    };
  if (!plate.printSeconds)
    return {
      ok: false,
      message: `Plate ${plate.index} has no print-time estimate in the file — enter the time manually.`,
    };
  const gramsPerUnit = new D(grams).div(unitsOnPlate).toDecimalPlaces(2, D.ROUND_UP);
  const minutes = Math.max(1, Math.ceil(plate.printSeconds / unitsOnPlate / 60));
  return {
    ok: true,
    gramsPerUnit: gramsPerUnit.toString(),
    printMinutesPerUnit: minutes,
    unitsPerBatch: unitsOnPlate,
    plateGrams: grams,
    plateSeconds: plate.printSeconds,
  };
}

export interface MaterialCandidate {
  id: string;
  typeCode: string;
  colorHex: string | null;
}

/** Suggest a material for a slicer filament: same type and colour first, then same type. */
export function matchMaterial<T extends MaterialCandidate>(filament: SliceFilament | null, materials: T[]): { material: T; exact: boolean } | null {
  if (!filament?.type) return null;
  const type = filament.type.trim().toUpperCase();
  const sameType = materials.filter((m) => m.typeCode.toUpperCase() === type);
  if (!sameType.length) return null;
  const color = filament.color?.toUpperCase();
  const exact = color ? sameType.find((m) => m.colorHex?.toUpperCase() === color) : undefined;
  return exact ? { material: exact, exact: true } : sameType.length === 1 ? { material: sameType[0], exact: false } : null;
}
