"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { formToObject, optDecimal, optText, reqText } from "@/domain/schemas/common";
import { materialSchema, receiveSchema } from "@/domain/schemas/catalog";
import { createMaterialType, createSupplier, receiveSpools, reconcileSpool, recordWaste, saveMaterial, setSpoolStatus } from "@/server/services/materials";

const refresh = (id?: string) => {
  revalidatePath("/materials");
  if (id) revalidatePath(`/materials/${id}`);
};

export async function saveMaterialAction(id: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const input = materialSchema.parse(formToObject(fd));
    const m = await saveMaterial(user.id, id, input);
    refresh(m.id);
    return { id: m.id };
  });
}

export async function receiveSpoolsAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ materialId: string; codes: string[]; pricePerKg: string }>> {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const input = receiveSchema.parse(formToObject(fd));
    const r = await receiveSpools(user.id, { ...input, spoolCount: input.spoolCount });
    refresh(input.materialId);
    revalidatePath("/finance");
    return { materialId: input.materialId, codes: r.codes, pricePerKg: r.pricePerKg };
  });
}

export async function reconcileSpoolAction(spoolId: string, materialId: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const i = z.object({ grossWeightG: optDecimal({ min: 0, label: "Scale reading" }), remainingG: optDecimal({ min: 0, label: "Net filament" }), note: optText(200) }).parse(formToObject(fd));
    const r = await reconcileSpool(user.id, spoolId, i);
    refresh(materialId);
    return r;
  }, "Spool weight updated.");
}

export async function wasteAction(spoolId: string, materialId: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const i = z.object({ grams: optDecimal({ min: 0.01, label: "Grams" }), reason: reqText("Reason", 200) }).parse(formToObject(fd));
    await recordWaste(user.id, spoolId, i.grams ?? "0", i.reason);
    refresh(materialId);
  }, "Waste recorded.");
}

export async function spoolStatusAction(spoolId: string, materialId: string, status: "EMPTY" | "DISCARDED" | "OPEN") {
  const user = await requireUser("inventory");
  return runAction(async () => {
    await setSpoolStatus(user.id, spoolId, status);
    refresh(materialId);
  }, "Spool updated.");
}

export async function createTypeAction(_prev: unknown, fd: FormData) {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const i = z.object({ code: reqText("Code", 20), name: reqText("Name", 60), defaultDensity: optDecimal({ min: 0.5, max: 3, label: "Density" }), description: optText(300) }).parse(formToObject(fd));
    await createMaterialType(user.id, i);
    revalidatePath("/materials/catalog");
  }, "Material type added.");
}

export async function createSupplierAction(_prev: unknown, fd: FormData) {
  const user = await requireUser("inventory");
  return runAction(async () => {
    const i = z.object({ name: reqText("Name", 80), website: optText(200), contactName: optText(80), email: optText(120), phone: optText(40), notes: optText(500) }).parse(formToObject(fd));
    await createSupplier(user.id, i);
    revalidatePath("/materials/catalog");
  }, "Supplier added.");
}
