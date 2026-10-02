// M3-10/11 in the combined state: invalid signature rejected, same signed sale.succeeded replayed 3x -> one credit; webhook-only unlock (no simulator). BASE_URL, .env
import { config } from "dotenv"; import crypto from "node:crypto"; import { Client } from "pg"; config({ path: ".env" });
const BASE = process.env.BASE_URL!; let fails = 0; const ok = (c: boolean, m: string) => { console.log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
async function main() {
  const { mockEvents, signMockEvent } = await import("../../src/server/payments/mock/events"); const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const link = (await db.query("select d.public_link_id l from drops d join sellers s on s.id=d.seller_id where d.status='published' and s.verification_status='verified' limit 1")).rows[0].l;
  const co = await (await fetch(BASE + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.53.1.1" }, body: JSON.stringify({ linkId: link, email: "wh2@example.test", confirmOver18: true }) })).json();
  const tx = co.transactionId as string; const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: co.amountCents }); const sg = signMockEvent(ev, process.env.PAYMENT_WEBHOOK_SECRET!);
  const send = (h: Record<string, string>, body = sg.rawBody) => fetch(BASE + "/api/webhooks/mock", { method: "POST", headers: h, body });
  const tampered = await send(sg.headers, sg.rawBody.replace(String(co.amountCents), "1")); ok(tampered.status === 401 || tampered.status === 400, `tampered body (amount changed) -> ${tampered.status}`);
  const nosig = await send({ "content-type": "application/json" }); ok(nosig.status === 401, `missing signature -> ${nosig.status}`);
  const st = async () => (await db.query("select status from transactions where id=$1", [tx])).rows[0].status; ok(await st() === "pending", "still pending after rejected events");
  const rs = []; for (let i = 0; i < 3; i++) rs.push((await send(sg.headers)).status); console.log("   replay statuses:", rs.join(","));
  const n = Number((await db.query("select count(*) from ledger_entries where transaction_id=$1 and entry_type='sale_credit'", [tx])).rows[0].count); ok(await st() === "succeeded" && n === 1 && rs.every((s) => s === 200), `signed event x3 -> status succeeded, ${n} sale_credit, all 200 (idempotent)`);
  const stj = await (await fetch(`${BASE}/api/checkout/status?id=${tx}`)).json(); ok(stj.status === "succeeded", "buyer status endpoint follows the webhook (no simulator involved)");
  const ev2 = mockEvents.saleSucceeded({ transactionId: tx, amountCents: co.amountCents, eventId: "evt_" + crypto.randomBytes(8).toString("hex") }); const sg2 = signMockEvent(ev2, process.env.PAYMENT_WEBHOOK_SECRET!); const r2 = await send(sg2.headers, sg2.rawBody); const n2 = Number((await db.query("select count(*) from ledger_entries where transaction_id=$1 and entry_type='sale_credit'", [tx])).rows[0].count); ok(n2 === 1, `second event id for the same sale (processor duplicate) -> ${r2.status}, still ${n2} credit`);
  console.log(`RESULT fails=${fails}`); await db.end(); (await import("../../src/server/db")).pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
