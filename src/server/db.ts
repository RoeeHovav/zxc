import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter, log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"] });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Shared Prisma client (reused across hot reloads in development). */
export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
/** Transaction client type accepted by services that may run inside a caller's transaction. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export { createClient };
