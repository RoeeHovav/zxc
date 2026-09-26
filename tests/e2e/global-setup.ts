import { execSync } from "node:child_process";
import { Client } from "pg";
import "dotenv/config";

/** Migrates and wipes the disposable E2E database. Requires `npm run build` beforehand. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set.");
  if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must differ from DATABASE_URL — it is wiped.");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const c = new Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
  await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await c.end();
}
