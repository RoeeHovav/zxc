import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/misc";
import { FileManager } from "@/components/files/file-manager";
import { ExpenseForm } from "../expense-form";
import { expenseFormData } from "../form-data";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("finance");
  const { id } = await params;
  const e = await prisma.expense.findUnique({ where: { id }, include: { files: { orderBy: { createdAt: "desc" } } } });
  if (!e) notFound();
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={e.description} back={{ href: "/finance/expenses", label: "Expenses" }} />
      <ExpenseForm id={id} {...await expenseFormData()} initial={{ ...e, amount: e.amount.toString(), vatAmount: e.vatAmount.toString() }} />
      <FileManager target={{ expenseId: id }} files={e.files} title="Receipt / invoice scans" purpose="RECEIPT" />
    </div>
  );
}
