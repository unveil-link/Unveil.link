/* eslint-disable */
// QA: real browser buy flow on mobile viewport (M3-01, M3-02, M3-03 UI, M3-15, M3-18, M3-20/S2-02 timing).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/workspace/unveil/package.json");
const { chromium } = require("playwright-core");
const [base, link] = process.argv.slice(2);
const out = []; const log = (id, r, ev) => { out.push({ id, result: r, evidence: ev }); console.log(r.padEnd(5), id, "—", ev); };
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", extraHTTPHeaders: { "x-forwarded-for": "10.55.1." + (1 + Math.floor(Math.random() * 200)) } });
const p = await ctx.newPage(); const cons = []; p.on("console", (m) => { if (m.type() === "error") cons.push(m.text().slice(0, 200)); }); p.on("pageerror", (e) => cons.push("pageerror " + e.message.slice(0, 200)));
const reqs = []; p.on("request", (r) => reqs.push(r.method() + " " + r.url()));
await p.goto(`${base}/u/${link}`); await p.waitForSelector('[data-testid="buy-form"]');
const text = await p.locator("body").innerText();
const hasFinal = /all sales (are )?final/i.test(text);
const sfLink = await p.locator('[data-testid="sales-final"]').innerText(); const sfVisible = await p.locator('[data-testid="sales-final"]').isVisible();
const btnBox = await p.locator('[data-testid="buy-button"]').boundingBox(); const sfBox = await p.locator('[data-testid="sales-final"]').boundingBox();
log("M3-18 (link page)", hasFinal && sfVisible && sfBox.y < btnBox.y ? "PASS" : "FAIL", `R2: "${sfLink}" visible=${sfVisible}, rendered above the Buy button (y ${Math.round(sfBox.y)} < ${Math.round(btnBox.y)}) on 390px viewport`);
await p.screenshot({ path: "qa/artifacts/pay3-ui-1-linkpage.png", fullPage: true });
// 18+ unchecked: browser-native required prevents submit
const t0 = Date.now();
await p.fill('input[type="email"]', "ui-buyer@example.test");
const before = reqs.length; await p.click('[data-testid="buy-button"]'); await p.waitForTimeout(500);
const submittedWithout = reqs.slice(before).some((r) => r.includes("/api/checkout"));
log("M3-15 UI", submittedWithout ? "FAIL" : "PASS", submittedWithout ? "checkout request sent without 18+ tick" : "unticked 18+ box blocks submit (HTML required); server also 400 (API case AGE-1)");
await p.check('[data-testid="over18"]'); await p.click('[data-testid="buy-button"]');
await p.waitForURL(/\/pay\/mock\//, { timeout: 15000 }); const tRedirect = Date.now() - t0;
await p.screenshot({ path: "qa/artifacts/pay3-ui-2-mockcheckout.png", fullPage: true });
await p.fill("#card", "4000 0000 0000 0002"); await p.click('button[type="submit"]'); await p.waitForSelector('[data-testid="mock-result"]'); const failTxt = await p.locator('[data-testid="mock-result"]').innerText();
const rawCode = /card_declined|insufficient_funds|expired_card|incorrect_cvc|session_expired|[a-z]+_[a-z_]+/.test(failTxt);
log("BUG-7 decline copy", !rawCode && /declin|try/i.test(failTxt) ? "PASS" : "FAIL", `R2 declined card message: "${failTxt}" (friendly, no raw failure code: ${!rawCode})`);
const sfHosted = await p.locator('[data-testid="sales-final"]').innerText().catch(() => ""); log("M3-18 (hosted checkout)", /all sales (are )?final/i.test(sfHosted) ? "PASS" : "FAIL", `R2 hosted page: "${sfHosted}"`);
await p.fill("#card", "4242 4242 4242 4242"); await p.click('button[type="submit"]'); await p.waitForTimeout(1500);
const retryTxt = await p.locator('[data-testid="mock-result"]').innerText();
log("M3-03e UI retry (R2 by-design change)", /succeeded|payment complete|thank/i.test(retryTxt) ? "PASS" : "FAIL", `R2: re-submitting a good card on the SAME declined session: "${retryTxt}" (was terminal in R1; now payable again)`);
// fresh happy path, timed (link page -> paid)
const t1 = Date.now(); await p.goto(`${base}/u/${link}`); await p.waitForSelector('[data-testid="buy-form"]'); await p.fill('input[type="email"]', "ui-buyer2@example.test"); await p.check('[data-testid="over18"]'); await p.click('[data-testid="buy-button"]');
await p.waitForURL(/\/pay\/mock\//, { timeout: 15000 }); const tRedirect2 = Date.now() - t1; await p.click('button[type="submit"]'); await p.waitForSelector('[data-testid="mock-result"]');
const okTxt = await p.locator('[data-testid="mock-result"]').innerText(); const tPaid = Date.now() - t1;
await p.screenshot({ path: "qa/artifacts/pay3-ui-3-result.png", fullPage: true });
log("M3-02 UI", /succeeded/i.test(okTxt) ? "PASS" : "FAIL", `fresh checkout with default 4242 card: "${okTxt}"`);
const hasRedirectToDownload = await p.locator('a[href*="/download"], [data-testid*="download"]').count();
log("M3-02 redirect", hasRedirectToDownload ? "PASS" : "BLOCKED", "No redirect to a download page after success: download/unlock delivery not built (documented known gap)");
log("M3-20 / S2-02", "BLOCKED", `link→paid (mock, mobile viewport, local, no typing delay) took ${(tPaid / 1000).toFixed(1)}s; link→checkout redirect ${(tRedirect2 / 1000).toFixed(1)}s; cannot reach 'download' step (not built)`);
const cardToApp = reqs.filter((r) => r.includes("/api/dev/payments/pay"));
log("M3-19 UI", "BLOCKED", `mock page posts card to our own origin (${cardToApp.length} requests to /api/dev/payments/pay); hosted-field requirement can only be assessed against a real processor`);
log("console", cons.length ? "NOTE" : "PASS", cons.length ? cons.join(" | ") : "no console errors");
fs.writeFileSync("qa/artifacts/pay3-ui-results.json", JSON.stringify(out, null, 2));
await b.close();
