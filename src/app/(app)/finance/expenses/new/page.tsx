import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui/misc";
import { ExpenseForm } from "../expense-form";
import { expenseFormData } from "../form-data";

export const metadata: Metadata = { title: "New expense" };

export default async function NewExpensePage() {
  await requireUser("finance");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Record expense"
        description="Filament purchases are best recorded via Materials → Receive spools, which also updates stock."
        back={{ href: "/finance/expenses", label: "Expenses" }}
      />
      <ExpenseForm id={null} {...await expenseFormData()} />
    </div>
  );
}
