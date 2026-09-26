"use server";
import { requireUser } from "@/server/auth";
import { runAction } from "@/server/action";
import { deleteAttachment } from "@/server/services/files";

export async function deleteFileAction(id: string) {
  const user = await requireUser();
  return runAction(() => deleteAttachment(user.id, String(id)), "File deleted.");
}
