import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  return <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description="Your business at a glance." />;
}
