import * as L from "/workspace/qa-fe7/qa/scripts/qa-fe7-lib.mjs"; const b = await L.browser(); const { p } = await L.login(b, L.seed.maya.email);
await p.goto(L.BASE + `/dashboard/drops/${L.seed.maya.dropIds.flagged}`, { waitUntil: "networkidle" });
console.log("file inputs:", await p.locator("input[type=file]").count(), "| buttons:", (await p.locator("button").allInnerTexts()).map((s)=>s.trim()).filter(Boolean).join(" / "));
console.log(await p.evaluate(() => [...document.querySelectorAll("section")].map(s=>s.innerText.slice(0,160).replace(/\n/g," ")).join("\n")));
await b.close();
