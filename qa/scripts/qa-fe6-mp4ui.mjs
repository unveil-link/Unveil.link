// FE-20 repro: dropzone advertises MP4 and the picker offers it; choosing an MP4 is then rejected client-side. env BASE, SEED, OUT, WT
import * as L from "./qa-fe6-lib.mjs"; import fs from "node:fs"; const { log, ok, seed } = L; const b = await L.browser();
const { p } = await L.login(b, seed.maya.email); await p.goto(L.BASE + "/dashboard/drops/new", { waitUntil: "networkidle" });
log("dropzone text: " + (await p.locator("text=/JPG, PNG, WebP or MP4/").first().innerText().catch(() => "(not found)")));
log("input accept: " + (await p.evaluate(() => document.querySelector("input[type=file]").accept)));
fs.writeFileSync("/tmp/w6/t.mp4", Buffer.from("00000018667479706d703432000000006d703432697" + "36f6d00000008667265" + "65", "hex"));
await p.setInputFiles("input[type=file]", "/tmp/w6/t.mp4"); await p.waitForTimeout(600);
const t = await p.evaluate(() => document.body.innerText); const m = t.match(/[^\n]*MP4 video uploads are coming soon[^\n]*/); log("after choosing t.mp4: " + (m ? m[0] : "(no message)"));
ok(!!m, "an MP4 chosen from the picker is rejected with 'coming soon' (no 415 round-trip)");
await p.screenshot({ path: `${L.OUT}/fe6-mp4-dropzone.png` }); await b.close(); L.done();
