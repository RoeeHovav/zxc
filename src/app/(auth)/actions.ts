"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db";
import { attemptLogin, normalizeEmail } from "@/server/auth/login";
import { clientIp, createSession, destroyCurrentSession, revokeOtherSessions } from "@/server/auth/session";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/services/common";
import { getSettings, getDefaultPolicy } from "@/server/services/settings";
import { seedReferenceData } from "@/server/services/reference-data";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string } | null;

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").slice(0, 254);
  const password = String(fd.get("password") ?? "").slice(0, 256);
  if (!email || !password) return { error: "Enter your email and password." };
  const ip = clientIp(await headers());
  const result = await attemptLogin(email, password, ip);
  if (!result.ok) {
    return result.reason === "rate_limited"
      ? { error: `Too many failed attempts. Try again in ${result.retryAfterMinutes} minutes.` }
      : { error: "Incorrect email or password." };
  }
  await createSession(result.userId);
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login");
}

const setupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    password: z.string().max(256),
    confirm: z.string(),
    businessName: z.string().trim().min(1, "Business name is required.").max(120),
    token: z.string().optional(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function setupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const expected = process.env.SETUP_TOKEN;
  const parsed = setupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { error: "Please fix the highlighted fields.", fieldErrors: fe };
  }
  if (expected && parsed.data.token !== expected) return { error: "Invalid setup token.", fieldErrors: { token: "Invalid setup token." } };
  const problem = passwordProblem(parsed.data.password, parsed.data.email);
  if (problem) return { error: problem, fieldErrors: { password: problem } };

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.$transaction(async (tx) => {
    // Serialize concurrent setup attempts: only the very first user may be created here.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if ((await tx.user.count()) > 0) return null;
    const u = await tx.user.create({ data: { email: normalizeEmail(parsed.data.email), name: parsed.data.name, passwordHash, role: "OWNER", passwordChangedAt: new Date() } });
    await getSettings(tx);
    await tx.settings.update({ where: { id: 1 }, data: { businessName: parsed.data.businessName } });
    await getDefaultPolicy(tx);
    await seedReferenceData(tx);
    await audit(tx, { userId: u.id, entityType: "USER", entityId: u.id, action: "SETUP", summary: "Owner account created" });
    return u;
  });
  if (!user) return { error: "Setup has already been completed. Please sign in." };
  await createSession(user.id);
  redirect("/dashboard?welcome=1");
}

export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const sessionUser = await requireUser();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });
  if (!(await verifyPassword(user.passwordHash, current))) return { error: "Current password is incorrect.", fieldErrors: { current: "Current password is incorrect." } };
  const problem = passwordProblem(next, user.email);
  if (problem) return { error: problem, fieldErrors: { password: problem } };
  if (next !== confirm) return { error: "Passwords do not match.", fieldErrors: { confirm: "Passwords do not match." } };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    await audit(tx, { userId: user.id, entityType: "USER", entityId: user.id, action: "PASSWORD_CHANGE", summary: "Password changed; other sessions signed out" });
  });
  await revokeOtherSessions(user.id);
  return { ok: true, message: "Password changed. Other devices were signed out." };
}

export async function signOutOtherSessionsAction(): Promise<FormState> {
  const user = await requireUser();
  await revokeOtherSessions(user.id);
  return { ok: true, message: "Signed out of all other devices." };
}
