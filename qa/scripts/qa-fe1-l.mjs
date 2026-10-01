// FE QA part L: checkout 429 countdown on buyer page (real limiter), security headers on HTML pages. env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const path of ["/", "/login", `/u/${seed.maya.links.spring}`, "/dashboard", "/design"]) { const r = await fetch(BASE + path, { redirect: "manual" }); const h = r.headers; log(`[headers] ${path} ${r.status}: CSP=${(h.get("content-security-policy") || "").length > 0} XCTO=${h.get("x-content-type-options")} XFO=${h.get("x-frame-options")} HSTS=${!!h.get("strict-transport-security")} RP=${h.get("referrer-policy")} PP=${!!h.get("permissions-policy")} unsafe-eval=${/unsafe-eval/.test(h.get("content-security-policy") || "")}`); }
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.39.1." + Math.floor(Math.random() * 200) } }); const p = await c.newPage(); const rs = [];
p.on("response", (r) => { if (r.url().endsWith("/api/checkout")) rs.push(`${r.status()}${r.headers()["retry-after"] ? " ra=" + r.headers()["retry-after"] : ""}`); });
await p.goto(`${BASE}/u/${seed.maya.links.spring}`); await p.locator("#agree").check(); const buy = p.locator("[data-testid=buy-button]");
for (let i = 0; i < 40 && !(await buy.isDisabled()); i++) { await buy.click(); await sleep(250); }
log("[M3-01] checkout responses:", rs.join(", ")); log("[M3-01] after limiter: button:", (await buy.innerText()).trim(), "| disabled:", await buy.isDisabled(), "| notice:", (await p.locator("[data-testid=checkout-notice]").innerText()).replace(/\n+/g, " | "));
await p.screenshot({ path: "qa/artifacts/frontend-dashboard/buyer-checkout-429-desktop.png", fullPage: true });
const t = []; for (let k = 0; k < 3; k++) { t.push((await buy.innerText()).trim()); await sleep(1000); } log("[M3-01] countdown ticks:", t.join(" -> "));
await b.close();
