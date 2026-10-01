// Usage: node scripts/screenshots-dashboard.mjs [baseUrl]
// Needs a running app + seeded data: `npx tsx scripts/seed-demo.ts` first (writes .e2e/seed.json).
// Output: screenshots/dashboard/<name>-<mobile-390x844|desktop-1280x800>.png  + overflow-report.json (360/390/1280).
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3400";
const seed = JSON.parse(readFileSync(new URL("../.e2e/seed.json", import.meta.url)));
const out = new URL("../screenshots/dashboard/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const mailDir = new URL("../.dev-mail/", import.meta.url).pathname;
const tmp = "/tmp/fe-upload-fixtures";
mkdirSync(tmp, { recursive: true });

const VIEWPORTS = {
  mobile: { name: "mobile-390x844", viewport: { width: 390, height: 844 }, dsf: 2, mobile: true },
  desktop: { name: "desktop-1280x800", viewport: { width: 1280, height: 800 }, dsf: 1, mobile: false },
};
const shots = [];
const overflow = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const rnd = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function ctxFor(vp, who) {
  const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile, extraHTTPHeaders: { "x-forwarded-for": rnd() } });
  if (who) {
    const r = await ctx.request.post(base + "/api/auth/login", { data: { email: seed[who].email, password: seed.password } });
    if (!r.ok()) throw new Error("login failed for " + who + " " + r.status());
  }
  return ctx;
}
async function snap(page, name, vp, opts = {}) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(opts.wait ?? 250);
  const file = `${name}-${vp.name}.png`;
  await page.screenshot({ path: out + file, fullPage: opts.fullPage ?? true });
  shots.push(file);
  console.log("shot", file);
}
// NB: not "networkidle": prod CSP upgrade-insecure-requests + prefetches of not-yet-existing /terms,/privacy keep the network busy on http://localhost.
const go = async (page, path) => { await page.goto(base + path, { waitUntil: "load" }); await page.waitForTimeout(500); };

async function measureOverflow(path, who) {
  for (const w of [360, 390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": rnd() } });
    if (who) await ctx.request.post(base + "/api/auth/login", { data: { email: seed[who].email, password: seed.password } });
    const p = await ctx.newPage();
    await p.goto(base + path, { waitUntil: "load" }); await p.waitForTimeout(400);
    overflow.push({ path, width: w, overflowPx: await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
    await ctx.close();
  }
}

// ---------- fixtures
async function noise(file, w, h) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(`${tmp}/${file}`);
}
await noise("harbour-01.png", 1000, 800);
await noise("harbour-02.png", 1000, 800);
await noise("harbour-03.png", 900, 700);
await sharp({ create: { width: 800, height: 600, channels: 3, background: "#4f3be8" } }).jpeg().toFile(`${tmp}/small.jpg`);
writeFileSync(`${tmp}/notes.txt`, "not an image");
writeFileSync(`${tmp}/clip.gif`, "GIF89a");

const phases = {
  async landing(vp) {
    const ctx = await ctxFor(vp); const page = await ctx.newPage();
    await go(page, "/"); await snap(page, "landing", vp);
    await go(page, "/design"); await snap(page, "design", vp);
    await ctx.close();
  },
  async signup(vp) {
    const ctx = await ctxFor(vp); const page = await ctx.newPage();
    await go(page, "/signup"); await snap(page, "signup", vp);
    await page.getByRole("button", { name: "Create account" }).click();
    await snap(page, "signup-validation-errors", vp);
    await page.getByLabel("Display name").fill("Alex Morgan");
    await page.getByLabel("Email").fill("alex@example.test");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await snap(page, "signup-weak-password-hint", vp);
    await page.getByLabel("Password", { exact: true }).fill("aaaaaaaaaaaa");
    await snap(page, "signup-pattern-rule", vp);
    await page.getByLabel("Password", { exact: true }).fill("password123456");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText(/too common/i).first().waitFor({ timeout: 20000 });
    await snap(page, "signup-weak-password-server", vp);
    await page.getByLabel("Password", { exact: true }).fill("Sunrise-Harbor-4821");
    await snap(page, "signup-strong-password", vp);
    await page.getByLabel("Email").fill(seed.maya.email);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("already exists").first().waitFor({ timeout: 8000 }).catch(() => {});
    await snap(page, "signup-email-taken", vp);
    // 429 — the real SIGNUP_IP limiter (10/h) returns exactly this shape; mocked here so we don't have to burn the quota.
    await page.route("**/api/auth/signup", (r) => r.fulfill({ status: 429, headers: { "retry-after": "42", "content-type": "application/json" }, body: JSON.stringify({ error: "Too many requests. Please try again later.", code: "rate_limited" }) }));
    await page.getByLabel("Email").fill("alex@example.test");
    await page.getByRole("button", { name: /Create account|Try again/ }).click();
    await page.getByTestId("throttle-notice").waitFor();
    await snap(page, "signup-429-rate-limited", vp);
    // long wait (FE-05): 4320 s must read "1 h 12 min", not raw seconds
    await page.unroute("**/api/auth/signup");
    await page.reload({ waitUntil: "load" });
    await page.route("**/api/auth/signup", (r) => r.fulfill({ status: 429, headers: { "retry-after": "4320", "content-type": "application/json" }, body: JSON.stringify({ error: "Too many requests. Please try again later.", code: "rate_limited" }) }));
    await page.getByLabel("Display name").fill("Alex Morgan");
    await page.getByLabel("Email").fill("alex@example.test");
    await page.getByLabel("Password", { exact: true }).fill("Sunrise-Harbor-4821");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByTestId("throttle-notice").waitFor();
    await snap(page, "signup-429-long-wait", vp);
    await ctx.close();
  },
  async signin(vp) {
    const ctx = await ctxFor(vp); const page = await ctx.newPage();
    await go(page, "/login"); await snap(page, "signin", vp);
    await page.getByRole("button", { name: "Sign in" }).click();
    await snap(page, "signin-validation-errors", vp);
    // unknown email => identical response to a wrong password (no account enumeration); fresh address so the per-email delay counter starts at 0
    await page.getByLabel("Email").fill(`nobody+${Date.now()}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("form-error").waitFor();
    await snap(page, "signin-wrong-credentials", vp);
    await page.route("**/api/auth/login", (r) => r.abort("failed"));
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-2");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText(/couldn.t reach/i).waitFor();
    await snap(page, "signin-network-error", vp);
    await page.unroute("**/api/auth/login");
    // REAL progressive delay (threshold 3): the 4th wrong attempt gets 429 login_delayed + Retry-After.
    await page.getByLabel("Email").fill(`ghost+${Date.now()}@example.test`);
    for (let i = 0; i < 4; i++) {
      await page.getByLabel("Password", { exact: true }).fill(`not-the-password-${i}`);
      const btn = page.getByRole("button", { name: /^Sign in$/ });
      if (await page.getByTestId("throttle-notice").count()) break;
      await btn.click();
      await page.waitForTimeout(900);
    }
    await page.getByTestId("throttle-notice").waitFor({ timeout: 8000 });
    await snap(page, "signin-lockout-countdown", vp, { wait: 0 });
    await page.waitForTimeout(3000);
    await snap(page, "signin-lockout-countdown-ticking", vp, { wait: 0 });
    await ctx.close();
  },
  async reset(vp) {
    const ctx = await ctxFor(vp); const page = await ctx.newPage();
    await go(page, "/forgot-password"); await snap(page, "forgot-password", vp);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await snap(page, "forgot-password-validation", vp);
    await page.getByLabel("Email").fill(seed.sam.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByTestId("forgot-done").waitFor();
    await snap(page, "forgot-password-sent", vp);
    // real single-use token from the dev mail transport (MAIL_TRANSPORT=file writes .dev-mail/*.txt)
    await page.waitForTimeout(1500);
    const mails = readdirSync(mailDir).filter((f) => f.endsWith(".txt")).map((f) => ({ f, t: statSync(mailDir + f).mtimeMs })).sort((a, b) => b.t - a.t);
    const token = readFileSync(mailDir + mails[0].f, "utf8").match(/token=([\w-]+)/)[1];
    await go(page, "/reset-password?token=" + token); await snap(page, "reset-password", vp);
    await page.getByLabel("New password").fill("password123456");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForTimeout(900);
    await snap(page, "reset-password-weak-server", vp);
    await go(page, "/reset-password?token=" + "a".repeat(43));
    await page.getByLabel("New password").fill("Sunrise-Harbor-9931");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByText("Link expired").waitFor();
    await snap(page, "reset-password-invalid-token", vp);
    await go(page, "/reset-password"); await snap(page, "reset-password-missing-token", vp);
    await ctx.close();
  },
  async buyer(vp) {
    const ctx = await ctxFor(vp); const page = await ctx.newPage();
    await go(page, `/u/${seed.maya.links.spring}`); await snap(page, "buyer-published", vp);
    await page.getByTestId("buy-button").click();
    await page.getByText("Please confirm to continue").waitFor();
    await snap(page, "buyer-needs-confirmation", vp);
    await page.getByLabel(/I agree to the/).check();
    await page.getByTestId("buy-button").click();
    await page.getByTestId("checkout-notice").waitFor();
    await snap(page, "buyer-checkout-test-mode", vp);
    // long 429 wait on the Buy button (FE-05)
    await page.route("**/api/checkout", (r) => r.fulfill({ status: 429, headers: { "retry-after": "3481", "content-type": "application/json" }, body: JSON.stringify({ error: "Too many requests.", code: "rate_limited" }) }));
    await page.getByTestId("buy-button").click({ force: true }).catch(() => {});
    await page.getByRole("button", { name: /Try again in/ }).waitFor();
    await snap(page, "buyer-429-long-wait", vp);
    await page.unroute("**/api/checkout");
    await go(page, `/u/${seed.maya.links.studio}`); await snap(page, "buyer-published-3-files", vp);
    await go(page, `/u/${seed.maya.links.unpublished}`); await snap(page, "buyer-unpublished", vp);
    await go(page, `/u/${seed.maya.links.draft}`); await snap(page, "buyer-draft-not-found", vp);
    await go(page, `/u/doesnotexist1`); await snap(page, "buyer-not-found", vp);
    for (const pth of ["terms", "privacy"]) { await go(page, "/" + pth); await snap(page, `placeholder-${pth}`, vp); }
    await go(page, "/design");
    const el = page.locator("#download").locator("xpath=..");
    await el.scrollIntoViewIfNeeded();
    const file = `download-page-panel-${vp.name}.png`;
    await el.screenshot({ path: out + file });
    shots.push(file); console.log("shot", file);
    await ctx.close();
  },
  async empty(vp) {
    const ctx = await ctxFor(vp, "sam"); const page = await ctx.newPage();
    await go(page, "/dashboard"); await snap(page, "dashboard-empty-state", vp);
    await go(page, "/dashboard/drops"); await snap(page, "drop-list-empty", vp);
    await ctx.close();
  },
  async overview(vp) {
    const ctx = await ctxFor(vp, "maya"); const page = await ctx.newPage();
    await go(page, "/dashboard"); await snap(page, "dashboard-overview", vp);
    await go(page, "/dashboard/drops"); await snap(page, "drop-list", vp);
    await page.getByRole("tab", { name: /Drafts/ }).click();
    await snap(page, "drop-list-filter-drafts", vp);
    await page.getByRole("tab", { name: /Under review/ }).click();
    await snap(page, "drop-list-filter-under-review", vp);
    await go(page, "/dashboard/drops");
    await page.getByRole("button", { name: "Unpublish" }).first().click();
    await snap(page, "drop-unpublish-confirm", vp, { fullPage: false });
    await page.keyboard.press("Escape");
    await go(page, `/dashboard/drops/${seed.maya.dropIds.draft}`);
    await snap(page, "drop-detail-draft", vp);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await page.getByLabel(/18 or older/).check();
    await snap(page, "drop-publish-attestation-dialog", vp, { fullPage: false });
    await page.keyboard.press("Escape");
    await go(page, `/dashboard/drops/${seed.maya.dropIds.spring}`); await snap(page, "drop-detail-published", vp);
    await go(page, `/dashboard/drops/${seed.maya.dropIds.flagged}`); await snap(page, "drop-detail-flagged", vp);
    await go(page, `/dashboard/drops/00000000-0000-0000-0000-000000000000`); await snap(page, "drop-detail-not-found", vp);
    await ctx.close();
  },
  async pending(vp) {
    const ctx = await ctxFor(vp, "jo"); const page = await ctx.newPage();
    await go(page, "/dashboard"); await snap(page, "dashboard-pending-verification", vp);
    await go(page, `/dashboard/drops/${seed.jo.dropId}`); await snap(page, "drop-detail-pending-verification", vp);
    await go(page, "/dashboard/drops/new"); await snap(page, "new-drop-empty", vp);
    await page.getByRole("button", { name: /Save draft/ }).click();
    await snap(page, "new-drop-validation-errors", vp);
    await page.getByLabel("Title").fill("Harbour mornings");
    await page.getByLabel("Price (USD)").fill("0.50");
    await page.locator("#files").setInputFiles([`${tmp}/notes.txt`, `${tmp}/clip.gif`, `${tmp}/small.jpg`]);
    await page.getByLabel("Price (USD)").blur();
    await snap(page, "new-drop-file-and-price-validation", vp);
    await page.locator("#files").setInputFiles([`${tmp}/harbour-01.png`, `${tmp}/harbour-02.png`, `${tmp}/harbour-03.png`]);
    for (const n of ["notes.txt", "clip.gif", "small.jpg"]) await page.getByRole("button", { name: `Remove ${n}` }).click();
    await page.getByLabel("Price (USD)").fill("18");
    await page.getByLabel("Description").fill("Three quiet frames from the harbour at first light.");
    await snap(page, "new-drop-filled", vp);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 50, downloadThroughput: -1, uploadThroughput: 350 * 1024 });
    await page.getByRole("button", { name: /Save draft/ }).click();
    await page.getByRole("progressbar").first().waitFor();
    await page.waitForTimeout(5500);
    await snap(page, "new-drop-mid-upload", vp, { wait: 0 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.getByTestId("drop-created").waitFor({ timeout: 90000 });
    await snap(page, "new-drop-success-draft", vp);
    await ctx.close();
  },
  async publishFlow(vp) {
    const ctx = await ctxFor(vp, "maya"); const page = await ctx.newPage();
    await go(page, "/dashboard/drops/new");
    await page.getByLabel("Title").fill("Harbour mornings");
    await page.getByLabel("Price (USD)").fill("18");
    await page.locator("#files").setInputFiles([`${tmp}/small.jpg`]);
    await page.getByLabel(/Publish right after upload/).check();
    await snap(page, "new-drop-publish-attestations", vp);
    await page.getByLabel(/18 or older/).check();
    await page.getByLabel(/own the rights/).check();
    await page.getByLabel(/agreed to its sale/).check();
    await page.getByRole("button", { name: "Upload & publish" }).click();
    await page.getByTestId("drop-created").waitFor({ timeout: 30000 });
    await snap(page, "new-drop-success-published", vp);
    await ctx.close();
  },
};

const only = process.env.ONLY ? process.env.ONLY.split(",").filter((x) => phases[x]) : Object.keys(phases);
for (const phase of only) {
  for (const vp of Object.values(VIEWPORTS)) {
    try { await phases[phase](vp); } catch (e) { console.error("PHASE FAILED", phase, vp.name, e.message.split("\n").slice(0, 4).join(" | ")); }
  }
}
if (!process.env.ONLY || process.env.ONLY === "overflow") {
  for (const [p, who] of [["/", null], ["/design", null], ["/signup", null], ["/login", null], ["/forgot-password", null], ["/dashboard", "maya"], ["/dashboard/drops", "maya"], ["/dashboard/drops/new", "maya"], [`/u/${seed.maya.links.spring}`, null], ["/u/doesnotexist1", null]]) await measureOverflow(p, who);
  writeFileSync(out + "overflow-report.json", JSON.stringify(overflow, null, 2));
  console.log("overflow >0:", overflow.filter((o) => o.overflowPx > 0));
}
await browser.close();
