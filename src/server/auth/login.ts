import "server-only";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "./password";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_ACCOUNT = 5;
export const MAX_FAILURES_PER_IP = 20;

// Pre-computed hash used to equalize timing when the email does not exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalizer-" + Math.random()));

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfterMinutes?: number };

async function recentFailures(key: string) {
  return prisma.loginAttempt.count({ where: { key, succeeded: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } });
}

/**
 * Verifies credentials with rate limiting per account and per IP.
 * Error responses are intentionally generic to avoid account enumeration.
 */
export async function attemptLogin(emailRaw: string, password: string, ip: string | null): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const emailKey = `email:${email}`;
  const ipKey = ip ? `ip:${ip}` : null;
  const [emailFails, ipFails] = await Promise.all([recentFailures(emailKey), ipKey ? recentFailures(ipKey) : Promise.resolve(0)]);
  if (emailFails >= MAX_FAILURES_PER_ACCOUNT || ipFails >= MAX_FAILURES_PER_IP) {
    return { ok: false, reason: "rate_limited", retryAfterMinutes: 15 };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  let valid = false;
  if (user && user.isActive) valid = await verifyPassword(user.passwordHash, password);
  else await verifyPassword(await getDummyHash(), password);

  const keys = [emailKey, ...(ipKey ? [ipKey] : [])];
  if (!valid || !user) {
    await prisma.loginAttempt.createMany({ data: keys.map((key) => ({ key, succeeded: false })) });
    return { ok: false, reason: "invalid" };
  }
  await prisma.$transaction([
    prisma.loginAttempt.deleteMany({ where: { key: emailKey } }),
    prisma.loginAttempt.create({ data: { key: emailKey, succeeded: true } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } }),
  ]);
  return { ok: true, userId: user.id };
}

/** Housekeeping: old attempts and expired sessions. Safe to call often. */
export async function pruneAuthTables() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
}
