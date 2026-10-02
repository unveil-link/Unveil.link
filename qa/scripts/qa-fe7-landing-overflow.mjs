// Landing page horizontal overflow at narrow widths: which element sticks out? (FE-22 CTA label "Create your account" is longer than "Start selling"). env BASE, TAG
import * as L from "./qa-fe7-lib.mjs"; const { log, ok } = L; const b = await L.browser(); const TAG = process.env.TAG ?? "branch";
for (const w of [320, 360, 375, 390, 412]) {
  const c = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, hasTouch: true }); const p = await c.newPage(); await p.goto(L.BASE + "/", { waitUntil: "networkidle" });
  const r = await p.evaluate(() => { const de = document.documentElement; const vw = de.clientWidth; const out = []; for (const e of document.querySelectorAll("body *")) { const b = e.getBoundingClientRect(); if (b.width && b.right > vw + 0.5) out.push({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 60), text: (e.innerText || "").slice(0, 40).replace(/\s+/g, " "), right: Math.round(b.right), w: Math.round(b.width) }); } return { vw, sw: de.scrollWidth, over: de.scrollWidth - vw, out: out.slice(0, 6) }; });
  log(`[${TAG} ${w}px] scrollWidth ${r.sw} vs viewport ${r.vw} -> overflow ${r.over}px; offenders: ${JSON.stringify(r.out)}`);
  ok(r.over <= 1, `[${TAG} ${w}px] landing: no horizontal scroll (${r.over}px)`);
  if (w === 360 || w === 320) await p.screenshot({ path: `${L.OUT}/fe7-landing-${TAG}-${w}.png`, fullPage: false });
  await c.close();
}
await b.close(); L.done();
