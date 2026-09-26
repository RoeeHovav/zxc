"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/action";
import { customerSchema } from "@/domain/schemas/customer";
import { formToObject } from "@/domain/schemas/common";
import { anonymizeCustomer, createCustomer, deleteCustomer, setArchived, updateCustomer } from "@/server/services/customers";

export async function saveCustomerAction(id: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser("customers");
  return runAction(async () => {
    const input = customerSchema.parse(formToObject(fd));
    const c = id ? await updateCustomer(user.id, id, input) : await createCustomer(user.id, input);
    revalidatePath("/customers");
    revalidatePath(`/customers/${c.id}`);
    return { id: c.id };
  });
}

export async function archiveCustomerAction(id: string, archived: boolean) {
  const user = await requireUser("customers");
  return runAction(
    async () => {
      await setArchived(user.id, id, archived);
      revalidatePath("/customers");
      revalidatePath(`/customers/${id}`);
    },
    archived ? "Customer archived." : "Customer restored.",
  );
}

export async function deleteCustomerAction(id: string) {
  const user = await requireUser("customers");
  return runAction(async () => {
    await deleteCustomer(user.id, id);
    revalidatePath("/customers");
  }, "Customer deleted.");
}

export async function anonymizeCustomerAction(id: string) {
  const user = await requireUser("settings");
  return runAction(async () => {
    await anonymizeCustomer(user.id, id);
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "Personal data erased. Financial records were kept.");
}
