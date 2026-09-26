"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { formToObject } from "@/domain/schemas/common";
import { expenseSchema } from "@/domain/schemas/expense";
import { deleteExpense, saveExpense } from "@/server/services/finance";

export async function saveExpenseAction(id: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("finance");
  return runAction(async () => {
    const e = await saveExpense(user.id, id, expenseSchema.parse(formToObject(fd)));
    revalidatePath("/finance", "layout");
    return { id: e.id };
  });
}

export async function deleteExpenseAction(id: string) {
  const user = await requireUser("finance");
  return runAction(async () => {
    await deleteExpense(user.id, id);
    revalidatePath("/finance", "layout");
  }, "Expense deleted.");
}
