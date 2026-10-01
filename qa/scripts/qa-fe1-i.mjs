// M1-02 presence-only: Google button with (fake) client id configured vs not. env BASE_ON, BASE_OFF
import { chromium } from "playwright-core"; const log = (...a) => console.log(...a); const OUT = "qa/artifacts/frontend-dashboard";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const [name, base] of [["google NOT configured (3205)", process.env.BASE_OFF], ["google configured with FAKE id (3207)", process.env.BASE_ON]]) { const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  for (const path of ["/login", "/signup"]) { await p.goto(base + path); const g = p.locator('a:has-text("Google"), button:has-text("Google")'); const n = await g.count(); const href = n ? await g.first().getAttribute("href") : null; log(`[M1-02] ${name} ${path}: google control count=${n} tag/href=${href}`); if (n && path === "/login") await p.screenshot({ path: `${OUT}/login-google-button-desktop.png`, fullPage: true }); } }
const r = await fetch(process.env.BASE_ON + "/api/auth/google", { redirect: "manual" }); log("[M1-02] GET /api/auth/google (fake id) ->", r.status, (r.headers.get("location") || "").replace(/client_id=[^&]+/, "client_id=<fake>").slice(0, 160));
const r2 = await fetch(process.env.BASE_OFF + "/api/auth/google", { redirect: "manual" }); log("[M1-02] GET /api/auth/google (not configured) ->", r2.status, await r2.text());
await b.close();
