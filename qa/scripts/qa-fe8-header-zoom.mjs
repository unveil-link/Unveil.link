// Landing header with a larger user font size (browser "font size" setting, not page zoom): root font 16/18/20/24px at 320..412px. Informational for FE-23. env BASE, TAG
import * as L from "./qa-fe8-lib.mjs"; const { log } = L; const b = await L.browser(); const TAG = process.env.TAG ?? "branch";
for (const fsz of [16, 18, 20, 24]) for (const w of [320, 360, 375, 390, 412]) {
  const c = await b.newContext({ viewport: { width: w, height: 800 } }); const p = await c.newPage(); await p.goto(L.BASE + "/", { waitUntil: "networkidle" }); await p.addStyleTag({ content: `html{font-size:${fsz}px !important}` });
  const r = await p.evaluate(() => { const de = document.documentElement; const bt = document.querySelector('header a[href="/signup"]').getBoundingClientRect(); const out = []; for (const e of document.querySelectorAll("body *")) { if (/\bsr-only\b/.test(String(e.className))) continue; const q = e.getBoundingClientRect(); if (q.width && q.right > de.clientWidth + 0.5) out.push(e.tagName.toLowerCase() + "." + String(e.className).slice(0, 25) + "@" + Math.round(q.right)); } return { over: de.scrollWidth - de.clientWidth, btnRight: Math.round(bt.right), out: out.slice(0, 3) }; });
  log(`   INFO [${TAG}] root font ${fsz}px @ ${w}px: page overflow ${r.over}px, header button right edge ${r.btnRight}${r.out.length ? " offenders " + JSON.stringify(r.out) : ""}`);
  if (fsz === 20 && w === 320) await p.screenshot({ path: `${L.OUT}/fe8-header-zoom-${TAG}-320-20px.png`, clip: { x: 0, y: 0, width: w, height: 80 } });
  await c.close();
}
await b.close();
