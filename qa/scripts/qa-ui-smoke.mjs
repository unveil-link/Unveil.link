// UI smoke via playwright-core + system Chrome: M1-01 redirect, upload UI, public page, footer links. Usage: BASE=... node qa/scripts/qa-ui-smoke.mjs
import { chromium } from "playwright-core"; import sharp from "sharp"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:3200";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await (await b.newContext()).newPage();
const cspErrors = []; p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text().slice(0, 160)); }); p.on("pageerror", (e) => cspErrors.push("pageerror " + e.message));
const email = `qa-ui-${crypto.randomBytes(3).toString("hex")}@example.com`;
await p.goto(BASE + "/signup");
console.log("[M1-01] signup form fields:", await p.locator("input").evaluateAll((e) => e.map((i) => `${i.name}:${i.type}`)));
await p.fill('input[name="displayName"]', "UI Tester").catch(() => {}); await p.fill('input[name="email"]', email); await p.fill('input[name="password"]', "Passw0rd!long");
await Promise.all([p.waitForURL("**/dashboard", { timeout: 15000 }), p.click('button[type="submit"]')]);
console.log("[M1-01] after submit URL:", p.url(), "| status badge:", await p.locator('[data-testid="verification-status"]').innerText());
fs.mkdirSync("/workspace/qa-run4/out", { recursive: true });
await p.screenshot({ path: "/workspace/qa-run4/out/ui-dashboard.png" });
console.log("[M1-05] dashboard inputs:", await p.locator("input,textarea,button").evaluateAll((e) => e.map((i) => `${i.tagName}:${i.name || i.textContent?.trim().slice(0, 20)}`)));
console.log("[M6-02] CSP violations / page errors in headless Chrome:", cspErrors.length, cspErrors.slice(0, 3));
await b.close();
