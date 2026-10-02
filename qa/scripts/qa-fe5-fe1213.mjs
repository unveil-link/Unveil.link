// FE-12 / FE-13 original repros: Ned (negative, after payout) and the never-paid-out chargeback seller (qa-fe5-cbhold.ts -> EMAIL=...). env BASE, SEED, OUT, WT, CBEMAIL
import * as L from "./qa-fe5-lib.mjs"; const { log, ok, seed } = L; const b = await L.browser();
const lum = (rgb) => { const [r, g, bl] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
const parse = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number); const cr = (a, b2) => { const [x, y] = [lum(a), lum(b2)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [name, email, vp] of [["ned", seed.ned.email, { width: 1280, height: 900 }], ["ned-mobile", seed.ned.email, { width: 390, height: 844 }], ["cb-never-paid-out", process.env.CBEMAIL, { width: 1280, height: 900 }], ["maya (positive control)", seed.maya.email, { width: 1280, height: 900 }]]) {
  const { c, p } = await L.login(b, email, vp); await p.waitForSelector("[data-testid=balance-cards]");
  const card = await p.locator("[data-testid=balance-cards] > *:first-child").evaluate((e) => ({ text: e.innerText.replace(/\s+/g, " "), cls: e.className }));
  const al = p.locator("[data-testid=negative-balance]"); const n = await al.count();
  log(`-- ${name}: card="${card.text}"`);
  if (name.startsWith("maya")) { ok(n === 0 && !/Balance owed/.test(card.text), "positive seller: no alert, 'Available' card"); await c.close(); continue; }
  ok(n === 1, "negative-balance alert present once");
  const info = await al.evaluate((e) => { const cs = getComputedStyle(e); const t = e.querySelector("p, div > div:last-child") ?? e; const ic = e.querySelector("svg"); return { role: e.getAttribute("role"), ah: e.getAttribute("aria-hidden"), live: e.getAttribute("aria-live"), cls: e.className, text: e.innerText.replace(/\s+/g, " "), bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color, iconColor: ic ? getComputedStyle(ic).color : null, tag: e.tagName }; });
  log("   alert:", JSON.stringify(info));
  ok(info.role === "status", `FE5: alert now has role="status" (got ${info.role}); still visible text, not hidden (aria-hidden=${info.ah})`);
  ok(/danger/.test(info.cls) && !/warning/.test(info.cls), `alert is danger-toned, not warning: ${info.cls.match(/\S*(danger|warning)\S*/g)}`);
  ok(await p.getByRole("status").filter({ hasText: /You owe/ }).count() === 1 && await p.getByRole("alert").filter({ hasText: /You owe/ }).count() === 0, "exposed as role=status (polite), not role=alert");
  const cardCls = card.cls; ok(/border-danger/.test(cardCls), "card is red (border-danger) — same family as the alert");
  const bgc = parse(info.bg), fg = parse(info.color); log(`   colours bg=${info.bg} text=${info.color} border=${info.border} icon=${info.iconColor}`);
  ok(cr(fg, bgc) >= 4.5, `text contrast ${cr(fg, bgc).toFixed(1)}:1 >= 4.5`); if (info.iconColor) ok(cr(parse(info.iconColor), bgc) >= 3, `icon contrast ${cr(parse(info.iconColor), bgc).toFixed(1)}:1 >= 3`);
  ok(!/after a payout|paid out|already been paid|came in after/i.test(info.text + " " + card.text), `FE-12: no 'after a payout' claim in card or alert`);
  ok(/Below zero\. It will be deducted from future earnings\./.test(card.text), `FE-12: card hint reads 'Below zero. It will be deducted from future earnings.'`);
  ok(/You owe \$\d/.test(info.text) && /deducted from your future earnings before your next payout/.test(info.text), `alert text: ${info.text}`);
  const full = await p.locator("main").innerText(); ok(!/after a payout|already been paid out|came in after/i.test(full), "FE-12: no such wording anywhere on /dashboard");
  await p.screenshot({ path: `${L.OUT}/fe5-negative-${name.replace(/[^a-z-]/g, "")}.png`, fullPage: true }); await c.close();
}
L.done(); await b.close();
