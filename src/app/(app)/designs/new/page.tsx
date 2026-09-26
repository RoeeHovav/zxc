import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui/misc";
import { firstParam } from "@/lib/utils";
import { DesignForm } from "../design-form";
import { designFormData } from "../form-data";

export const metadata: Metadata = { title: "New design project" };

export default async function NewDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("sales");
  const sp = await searchParams;
  const data = await designFormData();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New design project" back={{ href: "/designs", label: "Modeling & Scanning" }} />
      <DesignForm id={null} {...data} initial={{ customerId: firstParam(sp.customerId) ?? "" }} />
    </div>
  );
}
