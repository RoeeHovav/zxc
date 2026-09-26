import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Returns a human-readable problem, or null if the password is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 256) return "Password is too long.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4)
    return "Password must not contain your email name.";
  if (/^(.)\1+$/.test(password)) return "Password is too repetitive.";
  const common = ["password", "1234567890", "qwertyuiop", "printforge"];
  if (common.some((c) => password.toLowerCase().includes(c))) return "Password is too common.";
  return null;
}
