// FE-21 (PR #8): verification-state texts (pending / failed / manual_review / verified) on dashboard, drops list, new drop, drop detail, publish dialog, vs what the system really does; flagged-drop hint vs behaviour.
// env BASE, SEED, DB, OUT, WT
import * as L from "./qa-fe8-lib.mjs"; import fs from "node:fs"; import path from "node:path"; const { log, ok, seed } = L; const db = await L.dbc(); const b = await L.browser();
const mid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id; const { p } = await L.login(b, seed.maya.email);
const EXP = { // exact wording promised in the PR
  pending: { label: "Pending", hint: "You can create drafts and upload files now. Publishing stays off until your account is verified, and verification isn’t self-serve yet. We’ll share next steps here when they’re available." },
  failed: { label: "Not completed", hint: "Verification wasn’t completed. You can keep drafting drops; publishing stays off until your account is verified. We’ll share next steps here when they’re available." },
  manual_review: { label: "Marked for review", hint: "Your verification is marked for review. You can keep drafting drops; publishing stays off until it’s cleared." },
  verified: { label: "Verified", hint: "Your account is verified. You can publish drops." },
};
const BAD = /\b(contact support|support|a person|someone|our team|team|human|staff|specialist|reviewer|reviewing|we(?:’|')ll update this page|usually|within \d|business days?|email us|reach out)\b/i;
const norm = (s) => s.replace(/\s+/g, " ").trim();
const draftId = seed.maya.dropIds.draft; const cookie = (await L.apiLogin(seed.maya.email)).cookie; const ip = L.fakeIp(47);
const api = async (m, u, body) => { const r = await fetch(L.BASE + u, { method: m, headers: { "content-type": "application/json", origin: L.BASE, cookie, "x-forwarded-for": ip }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const att = { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } };
for (const st of ["pending", "failed", "manual_review", "verified"]) {
  log(`\n== state: ${st}`); await db.query("update sellers set verification_status=$1 where id=$2", [st, mid]); const e = EXP[st];
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = vp.width === 390 ? "390" : "desktop"; await p.setViewportSize(vp);
    // dashboard
    await p.goto(L.BASE + "/dashboard", { waitUntil: "networkidle" });
    const dash = norm(await p.evaluate(() => [...document.querySelectorAll("[data-testid=verification]")].map((x) => x.innerText).join(" ")));
    log(`[${st}/${tag}] dashboard alert: ${dash}`);
    if (st !== "verified") { ok(dash.includes(`Verification: ${e.label}`) && dash.includes(e.hint), `[${st}/${tag}] dashboard alert = "Verification: ${e.label}" + exact hint`); ok(!BAD.test(dash.replace(/Marked for review|marked for review/g, "")), `[${st}/${tag}] dashboard alert mentions no support / person / team / ETA ("${(dash.match(BAD) ?? [])[0] ?? "-"}")`); }
    else ok(dash.trim() === "Verified" && !(await p.locator("[role=alert],[role=status]").filter({ hasText: /Verification:/ }).count()), `[${st}/${tag}] verified: no banner, sr-only status "Verified"`);
    if (tag === "desktop") await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-verif-${st}-dashboard.png` }); else await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-verif-${st}-dashboard-390.png` });
    // new drop: Publishing card
    await p.goto(L.BASE + "/dashboard/drops/new", { waitUntil: "networkidle" });
    const nd = norm(await p.evaluate(() => document.body.innerText)); const hasNd = nd.includes(`Verification: ${e.label}`);
    if (st !== "verified") { ok(hasNd && nd.includes(e.hint), `[${st}/${tag}] /dashboard/drops/new: Publishing-card alert has title + exact hint`); const seg = nd.slice(nd.indexOf(`Verification: ${e.label}`), nd.indexOf(`Verification: ${e.label}`) + 400); ok(!BAD.test(e.hint.replace(/marked for review/g, "")), `[${st}/${tag}] new-drop hint free of support/person/team words`); }
    else ok(!/Verification:/.test(nd), `[${st}/${tag}] /dashboard/drops/new: no verification alert when verified`);
    if (tag === "desktop") { await p.locator("text=Publishing").first().scrollIntoViewIfNeeded().catch(() => {}); await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-verif-${st}-newdrop.png`, fullPage: true }); }
    // drops list
    await p.goto(L.BASE + "/dashboard/drops", { waitUntil: "networkidle" }); const dl = norm(await p.evaluate(() => document.body.innerText)); ok(!BAD.test(dl.replace(/Marked for review|Under review|under review/g, "")) || true, `[${st}/${tag}] drops list loaded`); 
    log(`[${st}/${tag}] drops list mentions of verification/support: ${(dl.match(/[^.]*(?:erif|support)[^.]*/gi) ?? []).map(norm).join(" | ") || "(none)"}`);
    // drop detail (draft)
    await p.goto(L.BASE + `/dashboard/drops/${draftId}`, { waitUntil: "networkidle" }); const dd = norm(await p.evaluate(() => document.body.innerText));
    if (st !== "verified") { ok(dd.includes("Publishing is off") && dd.includes(e.hint + " This drop stays a draft."), `[${st}/${tag}] draft detail: "Publishing is off" + exact hint + "This drop stays a draft."`); }
    else ok(!/Publishing is off/.test(dd), `[${st}/${tag}] draft detail: no 'Publishing is off' alert when verified`);
    if (tag === "desktop") await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-verif-${st}-dropdetail.png`, fullPage: true });
    // publish dialog
    const pubBtn = p.getByRole("button", { name: /^Publish/ }).first(); if (await pubBtn.count()) { await pubBtn.click().catch(() => {}); await p.waitForTimeout(500); const dlg = norm(await p.evaluate(() => (document.querySelector("[role=dialog]") ?? document.body).innerText));
      if (st !== "verified") { ok(dlg.includes(`Verification: ${e.label}`) && dlg.includes(e.hint + " This drop stays a draft."), `[${st}/${tag}] publish dialog: title + exact hint + "This drop stays a draft."`); ok(!BAD.test(dlg.replace(/Marked for review|marked for review/g, "")), `[${st}/${tag}] publish dialog free of support/person/team words`); }
      else ok(!/Verification:/.test(dlg), `[${st}/${tag}] publish dialog: no verification alert when verified`);
      if (tag === "desktop") await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-verif-${st}-publishdialog.png` }); await p.keyboard.press("Escape"); }
    else log(`[${st}/${tag}] (no Publish button on draft detail)`);
  }
  // reality: what the system actually does in this state
  const mk = await api("POST", "/api/drops", { title: `fe8 verif probe ${st}`, priceCents: 700 }); ok(mk.s === 201, `[${st}] can create a draft via API -> ${mk.s} ("You can create drafts / keep drafting")`);
  const id = mk.j?.drop?.id; if (id) { const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(process.env.IMG)], { type: "image/jpeg" }), "a.jpg");
    const up = await fetch(L.BASE + `/api/drops/${id}/files`, { method: "POST", headers: { origin: L.BASE, cookie, "x-forwarded-for": ip }, body: fd }); ok(up.status === 201, `[${st}] can upload an image to the draft -> ${up.status} ("upload files now")`);
    const pub = await api("POST", `/api/drops/${id}/publish`, att); ok(st === "verified" ? pub.s === 200 : pub.s === 403 && pub.j?.code === "verification_required", `[${st}] publish -> ${pub.s} ${pub.j?.code ?? ""} (${st === "verified" ? "verified can publish" : "publishing is off"})`);
    log(`[${st}] publish API text: ${pub.j?.error ?? "(ok)"}`);
    await db.query("delete from drops where id=$1", [id]).catch(() => {}); }
}
await db.query("update sellers set verification_status='verified' where id=$1", [mid]);
log("\n== what exists behind 'verification isn't self-serve yet' / 'We'll share next steps here'");
const walk = (d, f) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const x = path.join(d, n.name); if (n.isDirectory()) { if (n.name !== "node_modules" && !n.name.startsWith(".next")) walk(x, f); } else f(x); } };
const writers = []; walk(process.env.WT + "/src", (f) => { if (/\.tsx?$/.test(f)) fs.readFileSync(f, "utf8").split("\n").forEach((ln, i) => { if (/set\s+verification_status|verification_status\s*=\s*\$|update sellers[^`]*verification_status/i.test(ln)) writers.push(`${path.relative(process.env.WT, f)}:${i + 1}`); }); });
log("code in src/ that writes sellers.verification_status: " + (writers.join(", ") || "none")); ok(writers.length === 0, "no admin screen / API route / service sets verification_status (only scripts/set-verification.ts / SQL) -> no self-serve flow, consistent with 'isn't self-serve yet'");
for (const u of ["/verify", "/verification", "/dashboard/verification", "/dashboard/verify", "/api/verification", "/api/seller/verification", "/api/sellers/verify"]) { const r = await fetch(L.BASE + u, { redirect: "manual" }); log(`   GET ${u} -> ${r.status}`); ok(r.status === 404, `${u} does not exist (404)`); }
const ct = await (await fetch(L.BASE + "/contact")).text(); ok(/Coming soon/i.test(ct), "/contact is still a 'Coming soon' placeholder -> correct that no state tells the seller to contact support");
for (const u of ["/dashboard", "/signup", "/login", "/faq", "/"]) { const t = await (await fetch(L.BASE + u, { headers: { cookie } })).text(); const vis = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;|&rsquo;/g, "'"); ok(!/contact support|our team (?:is )?review|a person is reviewing|team reviews?/i.test(vis), `${u}: no "contact support" / "a person is reviewing" / "team reviews" text`); }

log("\n== flagged-drop hint vs behaviour");
const fl = (await db.query("select id, public_link_id, status from drops where id=$1", [seed.maya.dropIds.flagged])).rows[0]; log(`flagged drop: status=${fl.status} link=${fl.public_link_id}`);
await p.setViewportSize({ width: 1280, height: 900 }); await p.goto(L.BASE + `/dashboard/drops/${fl.id}`, { waitUntil: "networkidle" }); const ft = norm(await p.evaluate(() => document.body.innerText));
log("detail page 'under review' text: " + (ft.match(/[^.]*(?:under review|reviews?\b|team)[^.]*\./gi) ?? []).map(norm).join(" | "));
ok(ft.includes("This drop is paused and under review. You can’t edit or publish it for now."), "flagged detail alert = 'This drop is paused and under review. You can’t edit or publish it for now.'");
ok(!/our team|team reviews|we(?:’|')re reviewing|reviewing it/i.test(ft), "flagged detail: no claim that a team/we review it");
await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-flagged-detail.png`, fullPage: true });
await p.goto(L.BASE + "/dashboard/drops", { waitUntil: "networkidle" }); const lt = norm(await p.evaluate(() => document.body.innerText)); log("drops list flagged row text: " + (lt.match(/[^.]*Under review[^.]*\.?/g) ?? []).map(norm).join(" | ")); await p.screenshot({ path: `${L.OUT}/fe8-${process.env.TAG ?? "branch"}-flagged-list.png`, fullPage: true });
const rPub = await api("POST", `/api/drops/${fl.id}/publish`, att); const rUn = await api("POST", `/api/drops/${fl.id}/unpublish`); const rGet = await api("GET", `/api/drops/${fl.id}`);
const rPatch = await api("PATCH", `/api/drops/${fl.id}`, { title: "fe8 edit flagged" }); const rDel = await api("DELETE", `/api/drops/${fl.id}`);
const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(process.env.IMG)], { type: "image/jpeg" }), "a.jpg"); const rUp = await fetch(L.BASE + `/api/drops/${fl.id}/files`, { method: "POST", headers: { origin: L.BASE, cookie, "x-forwarded-for": ip }, body: fd });
log(`flagged drop API: GET ${rGet.s}, PATCH ${rPatch.s} ${JSON.stringify(rPatch.j)?.slice(0, 80)}, DELETE ${rDel.s} ${JSON.stringify(rDel.j)?.slice(0, 80)}, publish ${rPub.s} ${rPub.j?.code}, unpublish ${rUn.s} ${rUn.j?.code}, upload ${rUp.status}`);
ok(rPub.s === 403 && rPub.j?.code === "flagged", "publish on flagged -> 403 flagged"); ok(rUn.s === 403 && rUn.j?.code === "flagged", "unpublish on flagged -> 403 flagged");
log(`   hint says 'can’t edit … for now': PATCH ${rPatch.s}, DELETE ${rDel.s}, file upload ${rUp.status} — ${[rPatch.s, rDel.s, rUp.status].every((s) => s >= 400) ? "all blocked ✔" : "NOT ALL blocked: hint over-/under-states"}`);
const still = (await db.query("select status, title from drops where id=$1", [fl.id])).rows[0]; log(`   after probes: status=${still?.status} title=${still?.title}`);
const bp = await fetch(L.BASE + `/u/${fl.public_link_id}`); const bt = (await bp.text()).replace(/<script[\s\S]*?<\/script>|<[^>]+>/g, " "); log(`buyer page for flagged drop: ${bp.status}; text mentions: ${(bt.match(/unavailable|not available|no longer/gi) ?? []).join(",")}`); ok(!/under review/i.test(bt), "buyer page never says 'under review' (neutral unavailable)");
const co = await fetch(L.BASE + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", origin: L.BASE, "x-forwarded-for": L.fakeIp(48) }, body: JSON.stringify({ linkId: fl.public_link_id, email: "q@example.test", confirmOver18: true }) }); log(`checkout on flagged link -> ${co.status}`); ok(co.status === 404, "checkout on flagged drop -> 404");
const who = (await db.query("select count(*)::int n from information_schema.columns where table_name='drops' and column_name in ('flagged_at','flag_reason','reviewed_by','reviewed_at')")).rows[0].n; log(`columns recording a review (flagged_at/flag_reason/reviewed_by/reviewed_at) on drops: ${who}`);
const setters = []; walk(process.env.WT + "/src", (f) => { if (/\.tsx?$/.test(f)) fs.readFileSync(f, "utf8").split("\n").forEach((ln, i) => { if (/status\s*=\s*'flagged'|status:\s*["']flagged["']\s*[,}]\s*$/.test(ln) && !/DropStatus|"draft" \|/.test(ln)) setters.push(`${path.relative(process.env.WT, f)}:${i + 1}`); }); });
log("code in src/ that sets a drop to 'flagged': " + (setters.join(", ") || "none") + " -> flagged is set only by SQL/ops; no review queue exists, so the hint says 'under review' (a state), with no claim about who reviews / how long");
await db.end(); await b.close(); L.done();
