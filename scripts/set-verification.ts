// Dev helper: stand-in for the (future) identity-verification provider / admin review.
// usage: npm run verify-seller -- <email> [pending|verified|failed|manual_review]
import { config } from "dotenv";
import { Client } from "pg";
config({ path: ".env.local" });
config({ path: ".env" });

const [email, status = "verified"] = process.argv.slice(2);
const allowed = ["pending", "verified", "failed", "manual_review"];
if (!email || !allowed.includes(status)) {
  console.error("usage: npm run verify-seller -- <email> [pending|verified|failed|manual_review]");
  process.exit(1);
}
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "UPDATE sellers SET verification_status = $2 WHERE email = lower($1) RETURNING email, verification_status",
    [email, status],
  );
  console.log(r.rowCount ? r.rows[0] : "no such seller");
  await c.end();
})();
