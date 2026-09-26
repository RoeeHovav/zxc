import "dotenv/config";
import { afterAll, beforeAll } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR_TEST ?? "./storage/test-uploads";

beforeAll(async () => {
  const { resetDb } = await import("./helpers");
  await resetDb();
});

afterAll(async () => {
  const { prisma } = await import("@/server/db");
  await prisma.$disconnect();
});
