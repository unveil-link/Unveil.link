// Chargeback + $5 fee on a sale that is still inside the hold, seller has another pending sale: ledger/API/dashboard consistency. Run from the worktree: BASE_URL=... DB env from .env, npx tsx qa/scripts/qa-fe4-cbhold.ts
import { config } from "dotenv"; import crypto from "node:crypto"; import { Client } from "pg"; config({ path: ".env" });
const BASE = process.env.BASE_URL!; const PW = "Sunrise-Harbor-4821"; let n = 0; const ip = () => `10.52.${Math.floor(Math.random() * 250)}.${(n++ % 250) + 1}`;
const J = async (path: string, body: unknown, cookie?: string) => { const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null), ck: r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ") }; };
async function main() {
  const { mockEvents, signMockEvent } = await import("../../src/server/payments/mock/events");
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const email = `qa-cb-${crypto.randomBytes(3).toString("hex")}@example.com`; const su = await J("/api/auth/signup", { email, password: PW, displayName: "Charge Back" }); if (su.s !== 201) throw new Error("signup " + su.s);
  const sid = (await db.query("update sellers set verification_status='verified' where email=$1 returning id", [email])).rows[0].id; const link = crypto.randomBytes(9).toString("base64url").slice(0, 12);
  await db.query("insert into drops (seller_id,title,description,price_cents,status,public_link_id) values ($1,'CB drop','d',2000,'published',$2)", [sid, link]);
  const sale = async () => { const c = await J("/api/checkout", { linkId: link, email: `b${crypto.randomBytes(3).toString("hex")}@example.test`, confirmOver18: true }); const p = await J("/api/dev/payments/pay", { sessionId: c.j.checkoutUrl.split("/").pop(), card: "4242424242424242" }); if (p.j.status !== "succeeded") throw new Error("pay"); return c.j.transactionId as string; };
  const a = await sale(); await sale(); await db.query("update platform_settings set chargeback_fee_cents=500 where id=1");
  const sgn = signMockEvent(mockEvents.chargeback({ transactionId: a, amountCents: null }), process.env.PAYMENT_WEBHOOK_SECRET!); const w = await fetch(BASE + "/api/webhooks/mock", { method: "POST", headers: sgn.headers, body: sgn.rawBody }); await db.query("update platform_settings set chargeback_fee_cents=0 where id=1");
  console.log("chargeback webhook ->", w.status);
  const rows = (await db.query("select entry_type, component, amount_cents, (available_at > now()) pending from ledger_entries where seller_id=$1 and (entry_type like 'chargeback%') order by id", [sid])).rows; console.log("chargeback ledger lines:", JSON.stringify(rows));
  const lg = await J("/api/auth/login", { email, password: PW }); const e = await (await fetch(BASE + "/api/earnings", { headers: { cookie: lg.ck } })).json(); console.log("API balance:", JSON.stringify(e.balance), "lifetime:", JSON.stringify(e.lifetime));
  console.log("EMAIL=" + email); await db.end(); (await import("../../src/server/db")).pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
