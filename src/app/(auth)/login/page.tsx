import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if ((await prisma.user.count()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <AuthCard title="Sign in" description="Welcome back. Sign in to manage your print business.">
      <LoginForm next={next ?? ""} />
    </AuthCard>
  );
}
