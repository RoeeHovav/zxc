import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "../db";

const SESSION_DAYS = 30;
const RENEW_WITHIN_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `__Host-` prefix requires Secure, so it is used only when served over HTTPS in production. */
export const SESSION_COOKIE = process.env.APP_ENV === "production" ? "__Host-pf_session" : "pf_session";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken() {
  return randomBytes(32).toString("base64url");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "STAFF";
}

export async function createSession(userId: string) {
  const token = generateToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      ipAddress: clientIp(h),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Validates a raw token; extends the session (sliding expiry) when close to expiring. */
export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  if (session.expiresAt.getTime() - now < RENEW_WITHIN_DAYS * DAY_MS) {
    await prisma.session.update({ where: { id }, data: { expiresAt: new Date(now + SESSION_DAYS * DAY_MS), lastSeenAt: new Date() } });
  }
  const { user } = session;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Current user for this request (memoized per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeOtherSessions(userId: string) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await prisma.session.deleteMany({ where: { userId, NOT: token ? { id: hashToken(token) } : undefined } });
}

export function clientIp(h: Headers): string | null {
  // Only trust X-Forwarded-For when explicitly configured to run behind a reverse proxy.
  if (process.env.TRUST_PROXY === "1") {
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  }
  return h.get("x-real-ip")?.slice(0, 64) ?? null;
}
