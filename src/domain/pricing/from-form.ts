/**
 * Shared conversion from an editor line to an engine input. Used by the browser for
 * live previews and by the server for authoritative pricing, so both always agree.
 */
import { D } from "../money";
import { requiresModeling, requiresPrint, requiresScanning } from "./engine";
import type { LineInput, ResolvedMaterial, ResolvedPrinter, ServiceType } from "./types";

export interface LineFields {
  serviceType: ServiceType;
  quantity: number;
  gramsPerUnit: string | null;
  supportGramsPerUnit: string | null;
  purgeGramsPerBatch: string | null;
  unitsPerBatch: number | null;
  printMinutesPerUnit: string | null;
  setupMinutesPerBatch: string | null;
  postProcessMinutesPerUnit: string | null;
  extraCostPerUnit: string | null;
  extraCostNote: string | null;
  modelingMode: "HOURLY" | "FIXED";
  modelingHours: string | null;
  modelingFee: string | null;
  designFeeWaived: boolean;
  waivedReason: string | null;
  scanHours: string | null;
  scanCleanupHours: string | null;
  reverseEngineeringHours: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  /** PERCENT as 0–100. */
  discountValue: string | null;
  manualUnitPrice: string | null;
  manualPriceReason: string | null;
}

export interface Resolved {
  material: ResolvedMaterial | null;
  supportMaterial: ResolvedMaterial | null;
  printer: ResolvedPrinter | null;
}

function pctToFraction(v: string): string {
  try {
    return new D(v).div(100).toString();
  } catch {
    return v;
  }
}

export function lineToEngineInput(line: LineFields, resolved: Resolved): LineInput {
  const print = requiresPrint(line.serviceType);
  return {
    serviceType: line.serviceType,
    quantity: line.quantity,
    print: print
      ? {
          material: resolved.material,
          supportMaterial: resolved.supportMaterial,
          printer: resolved.printer,
          gramsPerUnit: line.gramsPerUnit,
          supportGramsPerUnit: line.supportGramsPerUnit,
          purgeGramsPerBatch: line.purgeGramsPerBatch,
          unitsPerBatch: line.unitsPerBatch ?? 1,
          printMinutesPerUnit: line.printMinutesPerUnit,
          setupMinutesPerBatch: line.setupMinutesPerBatch,
          postProcessMinutesPerUnit: line.postProcessMinutesPerUnit,
          extraCostPerUnit: line.extraCostPerUnit,
          extraCostNote: line.extraCostNote,
        }
      : null,
    modeling: requiresModeling(line.serviceType)
      ? { mode: line.modelingMode, hours: line.modelingHours, fixedFee: line.modelingFee, waived: line.designFeeWaived, waivedReason: line.waivedReason }
      : null,
    scanning: requiresScanning(line.serviceType) ? { scanHours: line.scanHours, cleanupHours: line.scanCleanupHours, reverseEngineeringHours: line.reverseEngineeringHours } : null,
    discount:
      line.discountType && line.discountValue !== null && line.discountValue !== ""
        ? { type: line.discountType, value: line.discountType === "PERCENT" ? pctToFraction(line.discountValue) : line.discountValue }
        : null,
    manualUnitPrice: print && line.manualUnitPrice !== null && line.manualUnitPrice !== "" ? { price: line.manualUnitPrice, reason: line.manualPriceReason ?? "" } : null,
  };
}

/**
 * Parses a print duration into minutes. Accepts "155", "2:35", "2h35m", "2h 35", "1.5h", "95m".
 * Returns null when it cannot be understood (never guesses).
 */
export function parseDurationToMinutes(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return round2(Number(s));
  let m = /^(\d+):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?$/.exec(s);
  if (m) return round2(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
  m = /^(\d+)\s*h\s*(\d+)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/.exec(s);
  if (m) return round2(Number(m[1]));
  m = /^(\d+)\s*d\s*(\d+)\s*h(?:\s*(\d+)\s*m?)?$/.exec(s);
  if (m) return Number(m[1]) * 1440 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
  return null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function formatMinutes(minutes: number | string | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === "") return "";
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n)) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}
