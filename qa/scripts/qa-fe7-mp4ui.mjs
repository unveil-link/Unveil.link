// FE-20 (PR #8): dropzone hint / accept / note / picked-MP4 message / drop-detail uploader, and what the API does for mp4 vs jpg. Run against the flag-false build and the flag-true build.
// env BASE, SEED, DB, OUT, WT, FLAG=false|true (what lib/features.ts VIDEO_UPLOAD is in the build under test), TAG (artifact suffix), IMG
import * as L from "./qa-fe7-lib.mjs"; import fs from "node:fs"; const { log, ok, seed } = L; const FLAG = process.env.FLAG === "true"; const TAG = process.env.TAG ?? (FLAG ? "flagtrue" : "flagfalse");
const b = await L.browser(); const { p, c } = await L.login(b, seed.maya.email); const db = await L.dbc();
const MP4 = "/tmp/w7/t.mp4"; fs.writeFileSync(MP4, Buffer.from("00000018667479706d703432000000006d703432697" + "36f6d00000008667265" + "65", "hex"));
log(`== build under test: VIDEO_UPLOAD=${FLAG} (${L.BASE})`);
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  await p.setViewportSize(vp); const tag = vp.width === 390 ? "390" : "desktop";
  await p.goto(L.BASE + "/dashboard/drops/new", { waitUntil: "networkidle" });
  const body = await p.evaluate(() => document.body.innerText);
  const hint = (body.match(/(JPG, PNG[^\n]*per drop)/) ?? [])[1]; const acc = await p.evaluate(() => document.querySelector("input[type=file]").accept);
  const note = (body.match(/Images \(JPG, PNG, WebP\) up to [^\n]*/) ?? [])[0];
  log(`[new/${tag}] dropzone hint: ${hint}`); log(`[new/${tag}] accept: ${acc}`); log(`[new/${tag}] note: ${note}`);
  ok(FLAG ? /JPG, PNG, WebP or MP4/.test(hint ?? "") : /^JPG, PNG or WebP · up to \d+ files/.test(hint ?? "") && !/MP4/i.test(hint ?? ""), `[new/${tag}] dropzone hint ${FLAG ? "offers MP4" : "is images only"}`);
  ok(FLAG ? /video\/mp4/.test(acc) && /\.mp4/.test(acc) : !/mp4|video/i.test(acc) && /image\/jpeg/.test(acc) && /\.webp/.test(acc), `[new/${tag}] accept attribute ${FLAG ? "includes video/mp4 + .mp4" : "has no video/mp4 / .mp4"}`);
  const vmentions = (body.match(/video|mp4/gi) ?? []).length; const comingSoon = (body.match(/Video upload is coming soon\./g) ?? []).length;
  ok(FLAG ? /MP4 video up to [\d.]+ ?\w+ each\./.test(note ?? "") && comingSoon === 0 : comingSoon === 1 && /Images \(JPG, PNG, WebP\) up to [\d.]+ ?\w+ each\. Video upload is coming soon\./.test(note ?? ""), `[new/${tag}] exactly one video note: "${FLAG ? "MP4 video up to … each." : "Video upload is coming soon."}" (video/mp4 mentions in page text: ${vmentions}, 'coming soon' notes: ${comingSoon})`);
  if (!FLAG) ok(vmentions === 1, `[new/${tag}] the only word 'video'/'MP4' on the page is that note (found ${vmentions})`);
  await p.setInputFiles("input[type=file]", MP4); await p.waitForTimeout(700);
  const t2 = await p.evaluate(() => document.body.innerText); const msg = (t2.match(/[^\n]*(?:Video upload is coming soon —|MP4|\.mp4)[^\n]*/g) ?? []).join(" | ");
  log(`[new/${tag}] after picking t.mp4: ${msg}`);
  if (!FLAG) ok(/Video upload is coming soon — for now, add JPG, PNG or WebP images\./.test(t2), `[new/${tag}] picked MP4 is rejected client-side with the new wording (no 415 round-trip)`);
  else ok(!/coming soon/.test(msg), `[new/${tag}] picked MP4 is accepted by the client when the flag is true (no 'coming soon' message)`);
  await p.screenshot({ path: `${L.OUT}/fe7-mp4-dropzone-${TAG}-${tag}.png` });
}
// drop detail (draft) uploader
await p.setViewportSize({ width: 1280, height: 900 });
const draftId = seed.maya.dropIds.draft; await p.goto(L.BASE + `/dashboard/drops/${draftId}`, { waitUntil: "networkidle" });
const dt = await p.evaluate(() => document.body.innerText); const dacc = await p.evaluate(() => [...document.querySelectorAll("input[type=file]")].map((i) => i.accept));
log(`[detail] file-input accept: ${JSON.stringify(dacc)}`); log(`[detail] uploader text: ${(dt.match(/[^\n]*(JPG, PNG|MP4|[Vv]ideo)[^\n]*/g) ?? []).join(" | ")}`);
ok(dacc.length > 0 && dacc.every((a) => (FLAG ? true : !/mp4|video/i.test(a))), `[detail] drop-detail file input accept ${FLAG ? "(flag true; not asserted)" : "has no video/mp4 / .mp4"}`);
ok(!/\bMP4\b|\bvideo\b/i.test(dt) || FLAG, `[detail] drop-detail page text has no MP4/video claim while the flag is false`);
await p.setInputFiles("input[type=file]", MP4); await p.waitForTimeout(700); const dt2 = await p.evaluate(() => document.body.innerText);
log(`[detail] after picking t.mp4: ${(dt2.match(/[^\n]*(?:coming soon —|\.mp4)[^\n]*/g) ?? []).join(" | ")}`);
if (!FLAG) ok(/Video upload is coming soon — for now/.test(dt2), `[detail] picked MP4 on the drop-detail uploader is rejected client-side with the new wording`);
await p.screenshot({ path: `${L.OUT}/fe7-mp4-dropdetail-${TAG}.png` });
// API reality: what upload does
const apiBase = L.BASE; const ip = L.fakeIp(46); const cookie = (await L.apiLogin(seed.maya.email)).cookie;
const mk = await (await fetch(apiBase + "/api/drops", { method: "POST", headers: { "content-type": "application/json", origin: apiBase, cookie, "x-forwarded-for": ip }, body: JSON.stringify({ title: `fe7 video probe ${TAG}`, priceCents: 500 }) })).json(); const id = mk.drop?.id;
const up = async (name, type, buf) => { const fd = new FormData(); fd.append("file", new Blob([buf], { type }), name); const r = await fetch(apiBase + `/api/drops/${id}/files`, { method: "POST", headers: { origin: apiBase, cookie, "x-forwarded-for": ip }, body: fd }); const t = await r.text(); return { s: r.status, t: t.slice(0, 160) }; };
const rv = await up("t.mp4", "video/mp4", fs.readFileSync(MP4)); const ri = await up("a.jpg", "image/jpeg", fs.readFileSync(process.env.IMG));
log(`[api] POST files video/mp4 -> ${rv.s} ${rv.t}`); log(`[api] POST files image/jpeg -> ${ri.s}`);
ok(rv.s === 415, `[api] upload of video/mp4 is rejected with 415 on this build (backend has no video support; m2-media not merged) — with the flag ${FLAG}: ${FLAG ? "UI would offer an upload that always fails (FE-20 inverse; guard must keep the flag false)" : "UI does not offer it ✔"}`);
ok(ri.s === 201, `[api] upload of image/jpeg -> 201`);
await db.query("delete from drops where id=$1", [id]).catch(() => {});
await db.end(); await b.close(); L.done();
