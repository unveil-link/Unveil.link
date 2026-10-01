import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

/**
 * DB-backed tests need a reachable Postgres. They derive a THROWAWAY database from TEST_DATABASE_URL (or DATABASE_URL from
 * .env, with the database name replaced), named `<base>_<suffix>` where the name must contain "test". If Postgres isn't
 * reachable the DB suites SKIP (pure-logic tests never need it). Migrations are applied from db/migrations in order.
 */
loadEnv({ path: ".env", quiet: true });

function baseUrl(): string | null {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

export async function dbReachable(): Promise<boolean> {
  const b = baseUrl();
  if (!b || b.includes("unused")) return false;
  const u = new URL(b);
  u.pathname = "/postgres";
  const c = new Client({ connectionString: u.toString(), connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

export async function createTestDb(suffix: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const u = new URL(baseUrl()!);
  const name = `unveil_paytest_${suffix}`;
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("test")) throw new Error(`refusing db name ${name}`);
  const admin = new URL(u.toString());
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  u.pathname = `/${name}`;
  const url = u.toString();
  const m = new Client({ connectionString: url });
  await m.connect();
  const dir = path.join(process.cwd(), "db", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await m.query(fs.readFileSync(path.join(dir, f), "utf8")); // one statement batch per file, like scripts/migrate.ts
  }
  await m.end();
  return {
    url,
    drop: async () => {
      const a = new Client({ connectionString: admin.toString() });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
