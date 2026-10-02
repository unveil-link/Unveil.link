// FE4 regression: adapted copy of qa-fe2-DUR/MODAL (buyer form now = email + #over18; lib import). env BASE, SEED, WT
// FE-02: modal focus return (mouse+keyboard), Esc, X, Keep, backdrop, focus trap, publish dialog, mobile. env BASE, SEED
import fs from "node:fs"; import { chromium } from "./qa-fe4-lib.mjs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function run(name, vp, ip) {
  log(`== ${name} ${vp.width}x${vp.height}`);
  const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": ip } }); const p = await c.newPage();
  await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
  await p.goto(BASE + "/dashboard/drops"); await sleep(600);
  const vis = (sel) => p.locator(sel).filter({ visible: true });
  const trig = () => vis('button:text-is("Unpublish")').first();
  const active = () => p.evaluate(() => { const e = document.activeElement; return { tag: e?.tagName, text: (e?.textContent || "").trim().slice(0, 20), inDialog: !!e?.closest("dialog"), id: e?.getAttribute("data-fe2") }; });
  // mark trigger so identity can be checked
  async function markTrigger() { await trig().evaluate((e) => e.setAttribute("data-fe2", "trigger")); }
  const isTrig = async () => (await active()).id === "trigger";
  for (const how of ["Escape", "Keep published", "X (Close dialog)", "Backdrop click", "Enter on Keep (keyboard)"]) {
    for (const open of ["mouse", "keyboard"]) {
      await markTrigger();
      if (open === "mouse") await trig().click(); else { await trig().focus(); await p.keyboard.press("Enter"); }
      await sleep(300);
      const a0 = await active(); ok(a0.inDialog, `[${open}] opened; initial focus inside dialog (${a0.tag}:${a0.text})`);
      if (how === "Escape") await p.keyboard.press("Escape");
      else if (how === "Keep published") await p.locator('dialog[open] button:has-text("Keep published")').click();
      else if (how.startsWith("X")) await p.locator('dialog[open] button[aria-label="Close dialog"]').click();
      else if (how === "Backdrop click") await p.mouse.click(5, 5);
      else { await p.locator('dialog[open] button:has-text("Keep published")').focus(); await p.keyboard.press("Enter"); }
      await sleep(350);
      const open2 = await p.locator("dialog[open]").count();
      ok(open2 === 0 && (await isTrig()), `[${open}] closed via ${how}; dialog closed=${open2 === 0}; focus returned to the SAME trigger button=${await isTrig()} (now ${JSON.stringify(await active())})`);
    }
  }
  // focus trap
  await markTrigger(); await trig().click(); await sleep(300);
  let outside = 0; const seen = new Set();
  for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); const a = await active(); seen.add(a.tag + ':' + a.text); if (!a.inDialog && a.tag !== 'BODY') outside++; }
  for (let i = 0; i < 12; i++) { await p.keyboard.press("Shift+Tab"); const a = await active(); if (!a.inDialog && a.tag !== 'BODY') outside++; }
  ok(outside === 0, `focus trap: 24 Tab/Shift+Tab presses never reached a focusable element outside the dialog (BODY = browser-chrome wrap step of native modal dialogs, content behind is inert; stops: ${[...seen].join(" | ")})`);
  await p.keyboard.press("Escape"); await sleep(300); ok(await isTrig(), "after trap test + Esc: focus back on trigger");
  // dialog a11y attributes
  await trig().click(); await sleep(300);
  const attrs = await p.evaluate(() => { const d = document.querySelector("dialog[open]"); return { labelledby: !!d.getAttribute("aria-labelledby") && !!document.getElementById(d.getAttribute("aria-labelledby")), describedby: !!d.getAttribute("aria-describedby"), modal: d.matches(":modal") }; });
  ok(attrs.labelledby && attrs.modal, `dialog is modal + labelled (${JSON.stringify(attrs)})`);
  await p.keyboard.press("Escape"); await sleep(250);
  // Publish dialog (draft/unpublished row)
  const pub = vis('button:text-is("Publish")').first();
  if (await pub.count()) {
    await pub.evaluate((e) => e.setAttribute("data-fe2", "trigger")); await pub.click(); await sleep(400);
    const a = await active(); ok(a.inDialog, `publish dialog opened, focus inside (${a.tag}:${a.text})`);
    await p.keyboard.press("Escape"); await sleep(350); ok(await isTrig(), `publish dialog: Esc returns focus to Publish trigger (${JSON.stringify(await active())})`);
    await pub.click(); await sleep(400);
    await p.locator('dialog[open] button:has-text("Cancel")').click().catch(() => p.locator('dialog[open] button[aria-label="Close dialog"]').click()); await sleep(350);
    ok(await isTrig(), `publish dialog: Cancel/X returns focus to trigger (${JSON.stringify(await active())})`);
  } else log("   (no visible Publish trigger)");
  await p.screenshot({ path: `qa/artifacts/fe4/modal-${name}.png` });
  await c.close();
}
await run("desktop", { width: 1280, height: 900 }, "10.62.1.1");
await run("mobile", { width: 390, height: 844 }, "10.62.1.2");
await b.close(); log(`RESULT fails=${fails}`);
