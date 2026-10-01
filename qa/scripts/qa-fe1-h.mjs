// FE QA part H: editor add-files incl. fake image, upload progress in editor. env BASE, DB
import { chromium } from "playwright-core"; import pg from "pg"; import sharp from "sharp"; import fs from "node:fs";
const BASE = process.env.BASE, OUT = "qa/artifacts/frontend-dashboard", TMP = "/workspace/qa-run5/out"; const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = JSON.parse(fs.readFileSync(TMP + "/c-state.json", "utf8")); const D = st.dropRow; const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.41.${Math.floor(Math.random()*200)}.9` } }); const p = await c.newPage(); const cons = [];
p.on("console", (m) => { if (m.type() === "error") cons.push(m.text().slice(0, 150)); });
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', st.email); await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
await p.goto(`${BASE}/dashboard/drops/${D.id}`); await p.waitForTimeout(500);
await p.setInputFiles('main input[type=file]', [`${TMP}/g.png`, `${TMP}/fake.jpg`]); await p.waitForTimeout(300);
await p.locator('main button:has-text("Upload 2 files")').click(); await p.waitForTimeout(3000);
log("[M1-05] editor upload result UI:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").match(/Add files.*/)?.[0].slice(0, 400));
log("[M1-05] files in DB now:", (await db.query("select filename, mime from drop_files where drop_id=$1 order by sort_order, created_at", [D.id])).rows.map((r) => r.filename + ":" + r.mime).join(", "));
await p.screenshot({ path: `${OUT}/editor-upload-result-desktop.png`, fullPage: true }); log("console errs:", cons);
await b.close(); await db.end();
