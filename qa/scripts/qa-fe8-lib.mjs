// shared helpers for the FE8 scripts. env: BASE, SEED, DB, OUT
import { createRequire } from "node:module"; import fs from "node:fs";
const require = createRequire(process.env.WT ? process.env.WT + "/package.json" : process.cwd() + "/package.json");
export const { chromium } = require("playwright-core"); export const pg = require("pg");
export const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/fe8"; fs.mkdirSync(OUT, { recursive: true });
export const seed = process.env.SEED ? JSON.parse(fs.readFileSync(process.env.SEED, "utf8")) : null;
export const PW = "Sunrise-Harbor-4821";
export const log = (...a) => console.log(...a); export let fails = 0; export const ok = (c, m) => { log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
export const usd = (c) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export async function dbc() { const c = new pg.Client({ connectionString: process.env.DB }); await c.connect(); return c; }
export const browser = () => chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let ipn = 1; export const fakeIp = (a = 43) => `10.${a}.${Math.floor(Math.random() * 250)}.${(ipn++ % 250) + 1}`;
export async function login(b, email, vp = { width: 1280, height: 900 }) {
  const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } }); const p = await c.newPage();
  await p.goto(BASE + "/login"); await p.fill('input[name="email"]', email); await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL("**/dashboard**"), p.locator("form button[type=submit]").click()]); return { c, p };
}
export async function apiLogin(email) { const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": fakeIp() }, body: JSON.stringify({ email, password: PW }) }); const ck = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; "); return { status: r.status, cookie: ck }; }
export const done = () => { log(`RESULT fails=${fails}`); };
