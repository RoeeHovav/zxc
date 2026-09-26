import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { AuthCard } from "../auth-card";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <AuthCard title="Create the owner account" description="First-run setup. This page disappears once the owner account exists.">
      <SetupForm needsToken={!!process.env.SETUP_TOKEN} />
    </AuthCard>
  );
}
