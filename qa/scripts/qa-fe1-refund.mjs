// M4-09 extra: refunded / charged_back rows must not count as gross/net. env BASE, SEED, DB
import { chromium } from "playwright-core"; import pg from "pg"; import fs from "node:fs";
const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); const log = (...a) => console.log(...a);
const mid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id;
const ins = (st, ref) => db.query(`insert into transactions (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, status, processor_ref) values ($1,$2,'r@example.test',5000,500,175,4325,$3,$4)`, [seed.maya.dropIds.spring, mid, st, ref]);
await ins("refunded", "qa_ref_1"); await ins("charged_back", "qa_cb_1");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.34.1.1" } })).newPage();
await p.goto(process.env.BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
await p.waitForSelector("text=Gross sales"); const t = (await p.locator("main").innerText()).replace(/\n+/g, " | "); log("[M4-09] after adding 1 refunded + 1 charged_back ($50 each) rows:", t.slice(t.indexOf("Earnings"), t.indexOf("Earnings") + 330));
log("[M4-09] refund/chargeback shown anywhere:", /refund|chargeback|charged back/i.test(t)); log("[M4-10] Spring row (should still be 18 sold / $216.00):", (await p.locator("main").innerText()).match(/Spring collection pack[^\n]*\n?[^\n]*/)?.[0]);
const rows = (await p.locator("tbody tr").allInnerTexts()).filter((x) => /Spring/.test(x)).map((x) => x.replace(/\s+/g, " ")); log("   ", rows[0]);
await db.query("delete from transactions where processor_ref in ('qa_ref_1','qa_cb_1')"); await b.close(); await db.end();
