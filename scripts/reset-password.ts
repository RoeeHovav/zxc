/**
 * Owner password recovery (no email needed). Run on the server:
 *   npm run user:reset-password -- owner@example.com            (generates a strong password)
 *   npm run user:reset-password -- owner@example.com "new pass"  (sets the given password)
 * All sessions of the user are revoked and failed-login counters cleared.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

async function main() {
  const [email, given] = process.argv.slice(2);
  if (!email) throw new Error("Usage: npm run user:reset-password -- <email> [new-password]");
  const { prisma } = await import("../src/server/db");
  const { hashPassword, passwordProblem } = await import("../src/server/auth/password");
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`No user with email ${email}.`);
  const password = given ?? randomBytes(12).toString("base64url");
  const problem = passwordProblem(password, user.email);
  if (problem) throw new Error(problem);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, isActive: true } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.loginAttempt.deleteMany({ where: { key: `email:${user.email}` } }),
    prisma.auditLog.create({ data: { userId: user.id, entityType: "USER", entityId: user.id, action: "PASSWORD_RESET", summary: "Password reset from the command line; all sessions revoked" } }),
  ]);
  console.log(`Password for ${user.email} was reset.${given ? "" : `\nNew password: ${password}\nChange it after signing in (Settings → Account & security).`}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
