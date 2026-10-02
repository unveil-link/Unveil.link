// Layout check for the longer FE-16 labels / reworded copy: horizontal overflow and clipped text at 320/360/390/768/1280. env BASE, SEED, OUT, WT
import * as L from "./qa-fe6-lib.mjs"; const { log, ok, seed, BASE } = L; const b = await L.browser();
const pages = [["landing", "/", false], ["login", "/login", false], ["signup", "/signup", false], ["buyer", `/u/${seed.maya.links.spring}`, false], ["dashboard", "/dashboard", true], ["drops", "/dashboard/drops", true], ["drop detail", `/dashboard/drops/${seed.maya.dropIds.spring}`, true]];
for (const w of [320, 360, 390, 768, 1280]) {
  const { c, p } = await L.login(b, seed.maya.email, { width: w, height: 900 });
  for (const [name, u] of pages.map((x) => [x[0], x[1]])) {
    await p.goto(BASE + u, { waitUntil: "networkidle" });
    const r = await p.evaluate(() => { const clipped = []; for (const e of document.querySelectorAll("dt, dd, th, td")) { if (!e.offsetParent) continue; const cs = getComputedStyle(e); if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible" && cs.overflowX !== "auto" && cs.overflowX !== "scroll") clipped.push((e.textContent || "").trim().slice(0, 40)); }
      return { over: document.documentElement.scrollWidth - innerWidth, clipped: clipped.slice(0, 5) }; });
    ok(r.over <= 0 && r.clipped.length === 0, `[${w}px] ${name}: horizontal overflow ${r.over}px, clipped elements ${JSON.stringify(r.clipped)}`);
    if (w === 320 && (name === "drops" || name === "landing")) await p.screenshot({ path: `${L.OUT}/fe6-${name.replace(" ", "-")}-320.png`, fullPage: true });
  }
  await c.close();
}
L.done(); await b.close();
