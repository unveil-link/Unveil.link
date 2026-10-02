// FE7 regression: adapted copy of qa-fe2-DUR/MODAL (buyer form now = email + #over18; lib import). env BASE, SEED, WT
// FE-05: 429 Retry-After boundaries through the REAL UI (mocked 429 via route). env BASE, SEED
import fs from "node:fs"; import { chromium } from "./qa-fe7-lib.mjs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a);
let fails = 0; const ok = (c, m) => { log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const cases = [[1, "1s"], [45, "45s"], [59, "59s"], [60, "60s"], [61, "61s"], [120, "120s"], [121, "3 min"], [300, "5 min"], [3480, "58 min"], [3481, "59 min"], [3540, "59 min"], [3599, "1 h"], [3600, "1 h"], [3601, "1 h 1 min"], [3661, "1 h 2 min"], [4320, "1 h 12 min"], [7200, "2 h"], [86399, "24 h"], [86400, "24 h"], [86401, "24 h 1 min"], [172800, "48 h"], [999999, "277 h 47 min"]];
const longs = { 3480: "58 minutes", 4320: "1 hour 12 minutes", 59: "59 seconds", 3600: "1 hour", 7200: "2 hours", 121: "3 minutes" };
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.63.1.1" } });
async function surface(name, path, api, fill, submit, labelSel, extra) {
  log(`== ${name}`);
  for (const [secs, want] of cases) {
    const p = await c.newPage(); let hit = 0;
    await p.route("**" + api, (r) => { hit++; return r.fulfill({ status: 429, headers: { "retry-after": String(secs), "content-type": "application/json" }, body: JSON.stringify({ error: "Too many attempts", code: secs > 1000 ? "login_delayed" : "rate_limited" }) }); });
    await p.goto(BASE + path); await fill(p); await p.locator(submit).first().click(); await p.waitForTimeout(450);
    const btn = (await p.locator(labelSel).first().innerText()).replace(/\s+/g, " ").trim();
    const cd = (await p.locator('[data-testid="countdown"]').count()) ? (await p.locator('[data-testid="countdown"]').first().innerText()).trim() : null;
    const sr = (await p.locator('[role=status]').allInnerTexts()).join(" | ") + " " + (await p.locator('[role=alert]').allInnerTexts()).join(" | ");
    const okBtn = btn.includes(`Try again in ${want}`); const okCd = cd === null || cd === want || cd === want.replace(/^(\d+)s$/, (_, n) => `${+n - 1}s`);
    const srOk = longs[secs] ? sr.includes(longs[secs]) : true;
    ok(hit === 1 && okBtn && okCd && srOk, `Retry-After ${secs}s -> button '${btn}' countdown ${JSON.stringify(cd)} (want '${want}')${longs[secs] ? ` | SR text has '${longs[secs]}': ${srOk}` : ""}`);
    await p.close();
  }
}
const loginFill = async (p) => { await p.fill('input[name="email"]', "nobody@example.test"); await p.fill('input[name="password"]', "Whatever-Pass-1234"); };
await surface("login (/api/auth/login)", "/login", "/api/auth/login", loginFill, "form button[type=submit]", "form button[type=submit]");
await surface("forgot-password", "/forgot-password", "/api/auth/forgot-password", async (p) => { await p.fill('input[name="email"]', "x@example.test"); }, "form button[type=submit]", "form button[type=submit]");
await surface("signup", "/signup", "/api/auth/signup", async (p) => { await p.fill('input[name="displayName"]', "Tester"); await p.fill('input[name="email"]', "t@example.test"); await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); }, "form button[type=submit]", "form button[type=submit]");
await surface("reset-password", "/reset-password?token=abc123", "/api/auth/reset-password", async (p) => { await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); const cf = p.locator('input[name="confirm"], input[name="confirmPassword"]'); if (await cf.count()) await cf.first().fill("Sunrise-Harbor-4821"); }, "form button[type=submit]", "form button[type=submit]");
// buyer checkout
log("== buyer checkout (/api/checkout)");
for (const [secs, want] of [[59, "59s"], [3480, "58 min"], [4320, "1 h 12 min"], [3600, "1 h"], [86400, "24 h"]]) {
  const p = await c.newPage(); await p.route("**/api/checkout", (r) => r.fulfill({ status: 429, headers: { "retry-after": String(secs), "content-type": "application/json" }, body: JSON.stringify({ error: "rate_limited" }) }));
  await p.goto(BASE + "/u/" + seed.maya.links.spring); await p.fill("#buyer-email", "a@example.test"); await p.locator("#over18").check(); await p.locator('[data-testid="buy-button"]').click(); await p.waitForTimeout(450);
  const btn = (await p.locator('[data-testid="buy-button"]').innerText()).replace(/\s+/g, " ").trim(); const body = await p.locator("main").innerText();
  const lg = { 59: "59 seconds", 3480: "58 minutes", 4320: "1 hour 12 minutes", 3600: "1 hour", 86400: "24 hours" }[secs];
  ok(btn.includes(`Try again in ${want}`) && body.includes(lg), `Retry-After ${secs}s -> buy button '${btn}', notice has '${lg}': ${body.includes(lg)}`);
  if (secs === 4320) await p.screenshot({ path: "qa/artifacts/fe7/buyer-429-1h12.png" });
  await p.close();
}
// screenshots login 58 min
{ const p = await c.newPage(); await p.route("**/api/auth/login", (r) => r.fulfill({ status: 429, headers: { "retry-after": "3481" }, contentType: "application/json", body: JSON.stringify({ error: "x", code: "login_delayed" }) })); await p.goto(BASE + "/login"); await loginFill(p); await p.locator("form button[type=submit]").click(); await p.waitForTimeout(500); await p.screenshot({ path: "qa/artifacts/fe7/login-429-58min.png" }); await p.close(); }
// dashboard upload 429 message (still raw seconds?)
log("== NewDropFlow / upload 429 text (not part of FE-05 scope; informational)");
const lines = fs.readFileSync((process.env.WT ?? ".") + "/lib/upload.ts", "utf8").split("\n").filter((l) => /retryAfter/.test(l) && /try again/i.test(l)); log("   upload.ts:", lines.join(" || ").trim());
const nd = fs.readFileSync((process.env.WT ?? ".") + "/components/dashboard/NewDropFlow.tsx", "utf8").split("\n").filter((l) => /retryAfter/.test(l) && /try again/i.test(l)); log("   NewDropFlow.tsx:", nd.join(" || ").trim());
await b.close(); log(`RESULT fails=${fails}`);
