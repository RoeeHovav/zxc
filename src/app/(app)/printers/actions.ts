"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { formToObject } from "@/domain/schemas/common";
import { maintenanceLogSchema, maintenanceTaskSchema, printerSchema } from "@/domain/schemas/catalog";
import { deleteMaintenanceTask, logMaintenance, saveMaintenanceTask, savePrinter } from "@/server/services/printers";

export async function savePrinterAction(id: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("production");
  return runAction(async () => {
    const input = printerSchema.parse({ ...formToObject(fd), materialTypeIds: fd.getAll("materialTypeIds").map(String) });
    const p = await savePrinter(user.id, id, input);
    revalidatePath("/printers");
    revalidatePath(`/printers/${p.id}`);
    return { id: p.id };
  });
}

export async function saveTaskAction(printerId: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("production");
  return runAction(async () => {
    await saveMaintenanceTask(user.id, printerId, maintenanceTaskSchema.parse(formToObject(fd)));
    revalidatePath(`/printers/${printerId}`);
  }, "Maintenance schedule saved.");
}

export async function deleteTaskAction(printerId: string, taskId: string) {
  const user = await requireUser("production");
  return runAction(async () => {
    await deleteMaintenanceTask(user.id, taskId);
    revalidatePath(`/printers/${printerId}`);
  }, "Maintenance task removed.");
}

export async function logMaintenanceAction(printerId: string, _prev: unknown, fd: FormData) {
  const user = await requireUser("production");
  return runAction(async () => {
    await logMaintenance(user.id, printerId, maintenanceLogSchema.parse(formToObject(fd)));
    revalidatePath(`/printers/${printerId}`);
    revalidatePath("/printers");
    revalidatePath("/dashboard");
  }, "Maintenance recorded.");
}
