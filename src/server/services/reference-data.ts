import "server-only";
import type { Tx } from "../db";

/** Standard filament families. Densities in g/cm³ are typical values, editable later. */
export const MATERIAL_TYPES: { code: string; name: string; density: string; description: string }[] = [
  { code: "PLA", name: "PLA", density: "1.24", description: "Easy to print, rigid, low heat resistance." },
  { code: "PETG", name: "PETG", density: "1.27", description: "Tough, chemical resistant, moderate heat resistance." },
  { code: "ABS", name: "ABS", density: "1.04", description: "Heat resistant and machinable; needs an enclosure." },
  { code: "ASA", name: "ASA", density: "1.07", description: "UV-stable ABS alternative for outdoor parts." },
  { code: "TPU", name: "TPU", density: "1.21", description: "Flexible elastomer." },
  { code: "PC", name: "Polycarbonate", density: "1.20", description: "Very strong and heat resistant." },
  { code: "PA", name: "Nylon (PA)", density: "1.14", description: "Tough, wear resistant; keep dry." },
  { code: "PLA-CF", name: "PLA Carbon Fiber", density: "1.29", description: "Stiff, matte; hardened nozzle required." },
  { code: "PETG-CF", name: "PETG Carbon Fiber", density: "1.30", description: "Stiff PETG composite; hardened nozzle required." },
  { code: "PVA", name: "PVA (soluble support)", density: "1.23", description: "Water-soluble support material." },
  { code: "HIPS", name: "HIPS", density: "1.04", description: "Support for ABS; dissolves in limonene." },
];

export async function seedReferenceData(tx: Tx) {
  for (const t of MATERIAL_TYPES) {
    await tx.materialType.upsert({
      where: { code: t.code },
      create: { code: t.code, name: t.name, defaultDensity: t.density, description: t.description },
      update: {},
    });
  }
}
