// FE-05 with the REAL limiter (no mocking): forgot-password per-IP limiter -> 429 Retry-After ~3500s. env BASE (default-limits instance)
import { chromium } from "playwright-core";
const BASE = process.env.BASE; const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.88.${Math.floor(Math.random()*200)}.${Math.floor(Math.random()*200)}` } }); const p = await c.newPage();
const ras = []; p.on("response", (r) => { if (r.url().endsWith("/api/auth/forgot-password")) ras.push(`${r.status()}:${r.headers()["retry-after"] ?? "-"}`); });
await p.goto(BASE + "/forgot-password"); const btn = p.locator("form button[type=submit]");
for (let i = 0; i < 8; i++) { await p.goto(BASE + "/forgot-password"); await p.fill('input[name="email"]', `real429-${i}@example.test`); await btn.click(); await p.waitForTimeout(700); if (await p.locator('[data-testid=countdown]').count()) break; }
console.log("responses:", ras.join(" "));
console.log("button:", (await btn.innerText()).trim(), "| countdown card:", (await p.locator('[data-testid=countdown]').allInnerTexts()).join("|"), "| SR:", (await p.locator("[role=status]").allInnerTexts()).join("|"));
await p.screenshot({ path: "qa/artifacts/frontend-dashboard-r2/forgot-429-real-58min.png" }); await b.close();
