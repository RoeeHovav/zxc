import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { listPolicies } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/misc";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("customers");
  const { id } = await params;
  const [c, policies] = await Promise.all([prisma.customer.findUnique({ where: { id } }), listPolicies()]);
  if (!c) notFound();
  if (c.anonymizedAt) redirect(`/customers/${id}`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${c.name}`} back={{ href: `/customers/${id}`, label: c.name }} />
      <CustomerForm id={id} policies={policies.map((p) => ({ id: p.id, name: p.name }))} initial={c} />
    </div>
  );
}
