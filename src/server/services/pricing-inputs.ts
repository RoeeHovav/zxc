import "server-only";
import type { Tx } from "../db";
import { dec } from "@/domain/money";
import type { LineForm } from "@/domain/schemas/sales";
import type { LineInput, PricingContext, ResolvedMaterial, ResolvedPrinter } from "@/domain/pricing/types";
import { requiresModeling, requiresPrint, requiresScanning } from "@/domain/pricing/engine";
import { resolveMaterial } from "./materials";
import { resolvePrinter } from "./printers";
import { buildPricingContext, getSettings, resolvePolicy } from "./settings";

/** Stored per line in `pricingInput`: the engine input plus the editor fields needed to reopen the line. */
export interface StoredLineInput extends LineInput {
  form: Omit<LineForm, "deadline"> & { deadline: string | null };
}

export interface ExistingLine {
  id: string;
  materialId: string | null;
  supportMaterialId: string | null;
  printerId: string | null;
  pricingInput: unknown;
}

function snapshotOf(existing: ExistingLine | undefined): StoredLineInput | null {
  if (!existing || !existing.pricingInput || typeof existing.pricingInput !== "object") return null;
  return existing.pricingInput as StoredLineInput;
}

/**
 * Resolves the pricing context: reuse the document snapshot unless the user asked to
 * re-price with current rates or changed the pricing policy.
 */
export async function resolveContext(tx: Tx, opts: { existing: PricingContext | null; policyId: string | null; refresh: boolean }): Promise<PricingContext> {
  if (opts.existing && !opts.refresh && (opts.existing.policy.id ?? null) === (opts.policyId ?? opts.existing.policy.id ?? null)) return opts.existing;
  const settings = await getSettings(tx);
  const policy = await resolvePolicy(tx, opts.policyId);
  return buildPricingContext(settings, policy);
}

/**
 * Converts an editor line into an engine input. Material and printer rates come from the
 * line's existing snapshot when unchanged (historical prices are preserved), otherwise from
 * the current catalog. Client-supplied rates are never trusted.
 */
export async function buildLineInput(tx: Tx, line: LineForm, existing: ExistingLine | undefined, refresh: boolean): Promise<StoredLineInput> {
  const snap = refresh ? null : snapshotOf(existing);
  const print = requiresPrint(line.serviceType);

  let material: ResolvedMaterial | null = null;
  let supportMaterial: ResolvedMaterial | null = null;
  let printer: ResolvedPrinter | null = null;
  if (print) {
    material = snap?.print?.material && snap.print.material.id === line.materialId ? snap.print.material : await resolveMaterial(tx, line.materialId);
    supportMaterial =
      line.supportMaterialId === null
        ? null
        : snap?.print?.supportMaterial && snap.print.supportMaterial.id === line.supportMaterialId
          ? snap.print.supportMaterial
          : await resolveMaterial(tx, line.supportMaterialId);
    printer = snap?.print?.printer && snap.print.printer.id === line.printerId ? snap.print.printer : await resolvePrinter(tx, line.printerId);
  }

  const discountValue =
    line.discountType && line.discountValue !== null
      ? line.discountType === "PERCENT"
        ? dec(line.discountValue).div(100).toString()
        : line.discountValue
      : null;

  const input: LineInput = {
    serviceType: line.serviceType,
    quantity: line.quantity,
    print: print
      ? {
          material,
          supportMaterial,
          printer,
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
    discount: line.discountType && discountValue !== null ? { type: line.discountType, value: discountValue } : null,
    manualUnitPrice: line.manualUnitPrice !== null && print ? { price: line.manualUnitPrice, reason: line.manualPriceReason ?? "" } : null,
  };
  return { ...input, form: { ...line, deadline: line.deadline ? line.deadline.toISOString() : null } };
}

/** Plain line data persisted in columns (shared by quote and order items). */
export function lineColumns(line: LineForm, position: number, stored: StoredLineInput, result: import("@/domain/pricing/types").LineResult) {
  const print = requiresPrint(line.serviceType);
  return {
    position,
    serviceType: line.serviceType,
    partName: line.partName,
    description: line.description,
    category: line.category,
    quantity: line.quantity,
    materialId: print ? line.materialId : null,
    supportMaterialId: print ? line.supportMaterialId : null,
    printerId: print ? line.printerId : null,
    designProjectId: line.designProjectId,
    colorNote: line.colorNote,
    deadline: line.deadline,
    specialInstructions: line.specialInstructions,
    pricingInput: JSON.parse(JSON.stringify(stored)),
    pricingResult: JSON.parse(JSON.stringify(result)),
    unitPrice: result.production?.unitPrice ?? null,
    lineNet: result.net,
    lineCost: result.cost,
  };
}
