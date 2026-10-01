// usage: npm run payments:janitor      (uses DATABASE_URL from .env; prints the counts as JSON; exit 1 on failure)
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

(async () => {
  const { runPaymentsJanitor } = await import("../src/server/payments/janitor");
  const { pool } = await import("../src/server/db");
  try {
    const r = await runPaymentsJanitor();
    console.log(JSON.stringify(r));
    if (!r.skipped && r.errors.length) process.exitCode = 1;
  } finally {
    await pool().end();
  }
})().catch((e) => {
  console.error("payments janitor failed:", e);
  process.exit(1);
});
