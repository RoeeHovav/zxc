import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listPolicies } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/misc";
import { CustomerForm } from "../customer-form";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("customers");
  const sp = await searchParams;
  const returnTo = firstParam(sp.returnTo);
  const policies = await listPolicies();
  const safeReturn = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : undefined;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New customer" back={{ href: "/customers", label: "Customers" }} />
      <CustomerForm id={null} policies={policies.map((p) => ({ id: p.id, name: p.name }))} returnTo={safeReturn} initial={{ name: firstParam(sp.name) ?? "" }} />
    </div>
  );
}
