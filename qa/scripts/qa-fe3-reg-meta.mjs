// FE3 regression: copy of qa-fe2-meta (FE-03 title, FE-04 badge, title XSS). Note: its old "og tags are generic" remark is superseded by FE3 fixes script. env BASE, SEED, DB
// FE-03 (title/og), FE-04 (verified badge vs verification_status), title XSS. env BASE, SEED, DB
import pg from "pg"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a);
let fails = 0; const ok = (c, m) => { log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const link = seed.maya.links?.spring ?? seed.maya.links.spring; const dropId = seed.maya.dropIds?.spring ?? seed.maya.dropIds.spring;
const get = async (id) => (await fetch(`${BASE}/u/${id}`)).text();
const title = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1];
const metas = (h) => [...h.matchAll(/<meta (?:property|name)="((?:og|twitter):[a-z:_]+|description)" content="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
log("== FE-03 buyer page title");
let h = await get(link); log("   <title>:", title(h)); log("   meta:", metas(h).join(" | "));
ok(title(h) === "Spring collection pack · Unveil", "published drop: <title> is '<drop title> · Unveil'");
ok(!/Unveil.*Unveil/.test(title(h)), "no double 'Unveil' in <title>");
ok((h.match(/<title>/g) || []).length === 1, "exactly one <title> tag");
const ogt = metas(h).find((m) => m.startsWith("og:title=")); log("   og:title =", ogt);
ok(!/Unveil · Unveil|Unveil — .*Unveil —/.test(ogt || ""), "og:title has no double-Unveil (note: og:title/og:description/twitter:* are the generic site-wide ones, not drop-specific)");
for (const [name, id] of [["unpublished", seed.maya.links?.unpublished ?? "mRDLOcg0pR1M"], ["draft", seed.maya.links?.draft ?? "Op8d66QK2PNU"], ["nonexistent", "zzzNoSuchLink"]]) { const t = title(await get(id)); ok(t === "Link unavailable · Unveil", `${name}: <title> = '${t}'`); }
// title XSS / special chars
const orig = (await db.query("select title from drops where id=$1", [dropId])).rows[0].title;
for (const t of ['<script>alert(1)</script> & "q" \'s\'', "</title><img src=x onerror=alert(1)>", "Unveil", "A".repeat(120)]) {
  await db.query("update drops set title=$2 where id=$1", [dropId, t]); h = await get(link);
  const tt = title(h); const raw = h.includes("<script>alert(1)</script> &") || h.includes("</title><img");
  log("   title in DB:", JSON.stringify(t.slice(0, 50)), "=> <title>:", JSON.stringify((tt || "").slice(0, 90)));
  ok(!raw && (h.match(/<title>/g) || []).length === 1, "special-char title is escaped in HTML (no raw tag injection)");
  if (t === "Unveil") ok(tt === "Unveil · Unveil", `drop literally titled 'Unveil' => '${tt}' (expected by design; cosmetic)`);
}
await db.query("update drops set title=$2 where id=$1", [dropId, orig]);
log("== FE-04 Verified badge vs verification_status");
const email = seed.maya.email;
const orig2 = (await db.query("select verification_status from sellers where email=$1", [email])).rows[0].verification_status; log("   original status:", orig2);
for (const st of ["pending", "failed", "manual_review", "verified"]) {
  await db.query("update sellers set verification_status=$2 where email=$1", [email, st]); h = await get(link);
  const has = /Verified creator/.test(h) || /data-testid="verified-badge"/.test(h); const renders = /Spring collection pack/.test(h);
  ok(renders && has === (st === "verified"), `status=${st}: page renders=${renders}; Verified badge shown=${has} (expected ${st === "verified"})`);
}
await db.query("update sellers set verification_status=$2 where email=$1", [email, orig2]); h = await get(link); ok(/Verified creator/.test(h), "restored: badge shown for verified seller");
// other seller (sam) isolation
const sam = (await db.query("select verification_status from sellers where email=$1", [seed.sam.email])).rows[0]; log("   sam status:", sam.verification_status);
await db.end(); log(`RESULT fails=${fails}`);
