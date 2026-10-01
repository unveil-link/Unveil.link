// M6-07 installability on the persistent profile + placeholder pages mobile/overflow + footer links audit. env BASE
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const dir = "/workspace/qa-run6/chrome-profile"; fs.rmSync(dir, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(dir, { executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true }); const p = ctx.pages()[0] ?? await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await p.goto(BASE + "/"); await cdp.send("Page.enable"); await new Promise((r) => setTimeout(r, 1500));
console.log("[M6-07] installability errors (persistent profile, http://localhost):", JSON.stringify((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors));
const m = await cdp.send("Page.getAppManifest"); const mj = JSON.parse(m.data); console.log("[M6-07] manifest errors:", JSON.stringify(m.errors), "| name:", mj.name, "| display:", mj.display, "| icons:", mj.icons.map((i) => i.sizes + ":" + i.purpose).join(","));
await ctx.close();
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  const c = await b.newContext({ viewport: vp }); const pg = await c.newPage(); const errs = []; pg.on("console", (x) => x.type() === "error" && errs.push(x.text()));
  for (const path of ["/terms", "/privacy", "/dmca", "/contact"]) { await pg.goto(BASE + path); const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, links: [...document.querySelectorAll("footer a")].map((a) => a.getAttribute("href")), h1: document.querySelector("h1")?.textContent })); console.log(`[M2-18] ${vp.width}px ${path}: hscroll=${o.sw > o.cw} h1=${o.h1} footer links=${o.links.join(",")}`);
    if (vp.width === 390) await pg.screenshot({ path: `qa/artifacts/frontend-dashboard-r2/placeholder${path.replace("/", "-")}-390.png` }); }
  // footer link click-through from landing
  await pg.goto(BASE + "/"); for (const [label, href] of [["Terms", "/terms"], ["Privacy", "/privacy"], ["DMCA", "/dmca"], ["Contact", "/contact"]]) { await pg.goto(BASE + "/"); await pg.locator("footer").getByRole("link", { name: label }).click(); await pg.waitForURL("**" + href); console.log(`[footer] landing footer '${label}' -> ${new URL(pg.url()).pathname} h1=${await pg.locator("h1").innerText()}`); }
  await pg.goto(BASE + "/u/bmCoZTUqlSQz"); await pg.locator("label a", { hasText: "Terms" }).click(); await pg.waitForURL("**/terms"); console.log("[footer] buyer page 'Terms' checkbox link ->", new URL(pg.url()).pathname);
  await pg.goto(BASE + "/signup"); for (const [label, href] of [["Terms", "/terms"], ["Privacy Policy", "/privacy"]]) { await pg.goto(BASE + "/signup"); await pg.getByRole("link", { name: label }).first().click(); await pg.waitForURL("**" + href); console.log(`[footer] signup '${label}' -> ${new URL(pg.url()).pathname}`); }
  console.log(`[console] ${vp.width}px errors:`, JSON.stringify(errs));
  await c.close();
}
// which pages carry which legal links
const c2 = await b.newContext(); const pg2 = await c2.newPage();
for (const path of ["/", "/login", "/signup", "/forgot-password", "/reset-password?token=x", "/u/bmCoZTUqlSQz", "/u/nope", "/terms", "/dashboard"]) { await pg2.goto(BASE + path); const hrefs = await pg2.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => ["/terms", "/privacy", "/dmca", "/contact"].includes(h))); console.log(`[links] ${path.padEnd(26)} -> ${[...new Set(hrefs)].join(",") || "(none)"} | footer element: ${await pg2.locator("footer").count()}`); }
await b.close();
