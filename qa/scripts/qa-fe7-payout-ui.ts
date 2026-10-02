// Dashboard "In payout"/"Paid out"/"Available" through the payout lifecycle (service functions, as seed-demo does): requested -> approved -> paid; requested -> failed (funds return). BASE_URL, .env, SEEDJSON
import { config } from "dotenv"; import fs from "node:fs"; import { chromium } from "playwright-core"; import { Client } from "pg"; config({ path: ".env" });
const BASE = process.env.BASE_URL!; const seed = JSON.parse(fs.readFileSync(process.env.SEEDJSON!, "utf8")); let fails = 0; const ok = (c: boolean, m: string) => { console.log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const usd = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
async function main() {
  const P = await import("../../src/server/payments/payouts"); const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const id = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id;
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.54.1.1" } }); const p = await c.newPage();
  await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); await Promise.all([p.waitForURL("**/dashboard**"), p.locator("form button[type=submit]").click()]);
  const view = async () => { await p.goto(BASE + "/dashboard"); await p.waitForSelector("[data-testid=balance-cards]"); const t = await p.locator("[data-testid=balance-cards]").innerText(); const g = (l: string) => (t.match(new RegExp(l + "\\s*\\n\\s*(-?\\$[\\d,]+\\.\\d\\d)")) || [])[1]; return { av: g("Available"), pe: g("Pending"), ip: g("In payout"), po: g("Paid out") }; };
  const api = async () => { const r = await p.request.get(BASE + "/api/earnings"); const j = await r.json(); return j; };
  const v0 = await view(); const e0 = await api(); console.log("   before:", JSON.stringify(v0)); ok(v0.av === usd(e0.balance.availableCents), "start state matches API");
  const pay = await P.requestPayout(id, 3000); let v = await view(); let e = await api(); ok(v.ip === usd(e0.lifetime.requestedPayoutCents + 3000) && v.av === usd(e0.balance.availableCents - 3000) && v.po === v0.po, `requested $30.00: In payout ${v.ip}, Available ${v.av} (was ${v0.av}), Paid out unchanged ${v.po}`);
  await P.approvePayout(pay.id); v = await view(); ok(v.ip === usd(e0.lifetime.requestedPayoutCents + 3000), `approved: still In payout ${v.ip}`);
  await P.markPayoutPaid(pay.id); v = await view(); e = await api(); ok(v.ip === usd(e0.lifetime.requestedPayoutCents) && v.po === usd(e0.lifetime.paidOutCents + 3000) && v.av === usd(e0.balance.availableCents - 3000), `paid: Paid out ${v.po} (+$30.00), In payout back to ${v.ip}, Available ${v.av}`);
  const net = e.balance.totalCents + e.lifetime.paidOutCents + e.lifetime.requestedPayoutCents; ok(e.balance.availableCents + e.balance.pendingCents + e.lifetime.requestedPayoutCents + e.lifetime.paidOutCents === net, "available + pending + in payout + paid out = net still holds");
  const p2 = await P.requestPayout(id, 2500); v = await view(); const a1 = v.av; await P.markPayoutFailed(p2.id, "qa test");
  v = await view(); ok(v.av === usd(e.balance.availableCents), `failed payout: funds return, Available ${v.av} == ${usd(e.balance.availableCents)} (was ${a1} while requested)`);
  let rej = ""; try { await P.requestPayout(id, 100); } catch (x: any) { rej = x.code ?? x.message; } ok(/below_minimum/.test(rej), `below-minimum request rejected: ${rej}`);
  console.log(`RESULT fails=${fails}`); await b.close(); await db.end(); (await import("../../src/server/db")).pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
