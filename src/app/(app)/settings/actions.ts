"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { runAction } from "@/server/action";
import { formToObject } from "@/domain/schemas/common";
import { policySchema, settingsSchema } from "@/domain/schemas/settings";
import { archivePolicy, savePolicy, updateSettings } from "@/server/services/settings";
import { verifyPaymentCaches } from "@/server/services/payments";
import { integrityReport } from "@/server/services/integrity";
import { prisma } from "@/server/db";
import { ServiceError } from "@/server/services/common";

export async function saveSettingsAction(_prev: unknown, fd: FormData) {
  const user = await requireUser("settings");
  return runAction(async () => {
    const data = settingsSchema.parse(formToObject(fd));
    await updateSettings(user.id, { ...data, country: data.country ?? "Israel" });
    revalidatePath("/", "layout");
  }, "Settings saved. New quotes use these values; existing documents keep their snapshot.");
}

export async function savePolicyAction(id: string | null, _prev: unknown, fd: FormData) {
  const user = await requireUser("settings");
  return runAction(async () => {
    await savePolicy(user.id, id, policySchema.parse(formToObject(fd)));
    revalidatePath("/settings/policies");
  }, "Pricing policy saved.");
}

export async function archivePolicyAction(id: string, archived: boolean) {
  const user = await requireUser("settings");
  return runAction(async () => {
    await archivePolicy(user.id, id, archived);
    revalidatePath("/settings/policies");
  }, archived ? "Policy archived." : "Policy restored.");
}

export async function setLogoAction(fileId: string | null) {
  const user = await requireUser("settings");
  return runAction(async () => {
    if (fileId) {
      const f = await prisma.fileAttachment.findUnique({ where: { id: fileId } });
      if (!f || !["png", "jpg", "jpeg"].includes(f.extension)) throw new ServiceError("Logo must be a PNG or JPEG.");
    }
    await updateSettings(user.id, { logoFileId: fileId });
    revalidatePath("/settings");
  }, "Logo updated.");
}

export async function integrityCheckAction() {
  await requireUser("settings");
  return runAction(async () => ({ payments: await verifyPaymentCaches(), ...(await integrityReport()) }));
}
