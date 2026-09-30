// Recreates a pristine e2e database and applies migrations. Uses E2E_DATABASE_URL.
import { Client } from "pg";
import { execSync } from "node:child_process";

const target = process.env.E2E_DATABASE_URL;
if (!target) throw new Error("E2E_DATABASE_URL not set");
const u = new URL(target);
const dbName = u.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("e2e")) {
  throw new Error(`refusing to reset database "${dbName}" (name must contain "e2e")`);
}
(async () => {
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();
  execSync("npx tsx scripts/migrate.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: target },
  });
})();
