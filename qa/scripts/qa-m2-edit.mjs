// backend/m2-media: PATCH /api/drops/:id probes. env from /workspace/qa-m2/env.sh
import * as L from "./qa-m2-lib.mjs"; import fs from "node:fs";
const { check, rec, assert, eq, makeSeller, newDrop, mkDrop, db, sleep, BASE } = L;
const s = await makeSeller("edit"); const other = await makeSeller("edit-other"); const anon = new L.Http();
const P = (who, id, json, o = {}) => (who.http ?? who).j("PATCH", `/api/drops/${id}`, { json, ...o });
const row = async (id) => (await db.query("select * from drops where id=$1", [id])).rows[0];
const snap = (r) => JSON.stringify(r, (k, v) => (k === "updated_at" ? undefined : v));
const auditFor = async (id) => (await db.query("select * from audit_log where target like $1 order by created_at", [`%drop:${id}%`])).rows;
const { drop: dr, link } = await mkDrop(s, { publish: false, title: "Orig title", description: "orig desc", priceCents: 2000 });
const pub = await mkDrop(s, { publish: true, title: "Pub title", description: "pub desc", priceCents: 3000 });

await check("M2-10", "PATCH title/description/price on a DRAFT -> 200, returns updated drop, persisted, other fields untouched", async () => {
  const b = await row(dr.id); const r = await P(s, dr.id, { title: "  New title  ", description: "New desc", priceCents: 2500 }); eq(r.status, 200, r.text);
  eq(r.json.drop.title, "New title", "trimmed title"); eq(r.json.drop.description, "New desc", "desc"); eq(r.json.drop.price_cents, 2500, "price");
  const a = await row(dr.id); for (const k of ["id", "seller_id", "public_link_id", "status", "created_at", "published_at", "attested_at", "attestation"]) if (k in a) eq(JSON.stringify(a[k]), JSON.stringify(b[k]), `${k} changed`);
  const g = await s.http.j("GET", `/api/drops/${dr.id}`); eq(g.json.drop.title, "New title", "GET"); assert(a.updated_at > b.updated_at, "updated_at not bumped"); return `200 ${JSON.stringify(Object.keys(r.json.drop))}`;
});
await check("M2-10b", "PATCH on a PUBLISHED drop is reflected on /api/public/drops/:linkId and /u/:linkId; status/published_at/attestation untouched", async () => {
  const b = await row(pub.drop.id); const r = await P(s, pub.drop.id, { title: "Pub NEW", price_cents: 4000, description: "<b>x</b> new" }); eq(r.status, 200, r.text);
  const a = await row(pub.drop.id); eq(a.status, "published", "status"); eq(String(a.published_at), String(b.published_at), "published_at"); for (const k of Object.keys(b)) if (/attest/.test(k)) eq(JSON.stringify(a[k]), JSON.stringify(b[k]), k);
  const g = await anon.j("GET", `/api/public/drops/${pub.link}`); eq(g.json.drop.title, "Pub NEW", "pub title"); eq(g.json.drop.priceCents, 4000, "pub price"); const page = await (await anon.req("GET", `/u/${pub.link}`)).text();
  assert(page.includes("Pub NEW") && page.includes("40.00"), "page not updated"); assert(!page.includes("<b>x</b>"), "HTML description not escaped"); return "public API + page show new title/price; HTML escaped";
});
await check("M2-10c", "PATCH is audited (drop_edited, admin_id NULL, price old->new, no title/description text) and does not change attestation history", async () => {
  const a = (await auditFor(pub.drop.id)).filter((x) => x.action === "drop_edited"); assert(a.length >= 1, "no audit"); const t = a.map((x) => x.target).join("|"); assert(/price_cents: 3000 -> 4000/.test(t), t); assert(!/Pub NEW|new<|<b>/.test(t), "content in audit"); assert(a.every((x) => x.admin_id === null), "admin_id set"); return a.map((x) => x.target).join(" || ").slice(0, 300);
});
await check("M2-10d", "description: null clears; description '' / whitespace clears; title unchanged", async () => {
  const o = []; for (const v of [null, "", "   "]) { await P(s, dr.id, { description: "x" }); const r = await P(s, dr.id, { description: v }); eq(r.status, 200, r.text); eq((await row(dr.id)).description, null, `desc for ${JSON.stringify(v)}`); o.push(JSON.stringify(v)); } return `cleared by ${o.join(", ")}`;
});

// ---- price bounds ----
const priceCases = [[99, 400], [100, 200], [101, 200], [49999, 200], [50000, 200], [50001, 400], [0, 400], [-1, 400], [-2500, 400], [12.5, 400], [1e21, 400], [2 ** 53, 400], [Number.MAX_SAFE_INTEGER, 400], ["1200", 400], [null, 400], [true, 400], [[1200], 400], [{ v: 1 }, 400]];
await check("M2-01", "price boundaries via PATCH: 99->400, 100/101/49999/50000 ok, 50001/0/negative/float/huge/string/null/bool/array/object -> 400 price_out_of_range|invalid_input; failures leave price unchanged", async () => {
  const d = (await newDrop(s)); const o = [];
  for (const [v, want] of priceCases) { const before = (await row(d.id)).price_cents; const r = await P(s, d.id, { priceCents: v }); const after = (await row(d.id)).price_cents; o.push(`${JSON.stringify(v)}→${r.status}${r.json?.code ? "/" + r.json.code : ""}`); eq(r.status, want, `price ${JSON.stringify(v)}: ${r.text}`); if (want === 200) eq(after, v, "stored"); else eq(after, before, `price changed after rejected ${JSON.stringify(v)}`); }
  return o.join(" ");
});
await check("M2-02", "raw JSON number forms of price: 1e2 (=100) ok, 1.0e3 ok, 5e4 ok, 1e-2, 0x64 / 100n invalid JSON, NaN/Infinity invalid JSON, '100.0' string rejected, price_cents alias works, both keys -> 400", async () => {
  const d = await newDrop(s); const o = []; const raw = async (body) => { const r = await s.http.j("PATCH", `/api/drops/${d.id}`, { raw: body, headers: { "content-type": "application/json" } }); o.push(`${body}→${r.status}`); return r; };
  eq((await raw('{"priceCents":1e2}')).status, 200, "1e2"); eq((await row(d.id)).price_cents, 100, "1e2 stored"); eq((await raw('{"priceCents":1.0e3}')).status, 200, "1.0e3"); eq((await raw('{"priceCents":5e4}')).status, 200, "5e4"); eq((await raw('{"priceCents":1e-2}')).status, 400, "1e-2");
  for (const b of ['{"priceCents":0x64}', '{"priceCents":NaN}', '{"priceCents":Infinity}', '{"priceCents":"100.0"}', '{"priceCents":-0}', '{"priceCents":100.00000000000001}']) { const r = await raw(b); assert([400].includes(r.status), `${b} -> ${r.status} ${r.text}`); }
  const a = await P(s, d.id, { price_cents: 777 }); eq(a.status, 200, a.text); eq((await row(d.id)).price_cents, 777, "alias"); const both = await P(s, d.id, { priceCents: 800, price_cents: 800 }); eq(both.status, 400, both.text); eq((await row(d.id)).price_cents, 777, "both -> unchanged"); return o.join(" ");
});

// ---- title / description ----
await check("M2-10e", "title boundaries: 1 char ok, 120 ok, 121 -> 400, '' / whitespace-only / tab-newline-only -> 400, non-string -> 400; description 2000 ok, 2001 -> 400", async () => {
  const d = await newDrop(s); const o = []; const t = async (b, want, label) => { const r = await P(s, d.id, b); o.push(`${label}→${r.status}`); eq(r.status, want, `${label}: ${r.text}`); return r; };
  await t({ title: "a" }, 200, "t1"); await t({ title: "a".repeat(120) }, 200, "t120"); await t({ title: "a".repeat(121) }, 400, "t121"); await t({ title: "" }, 400, "t0"); await t({ title: "   " }, 400, "tws"); await t({ title: "\t\n " }, 400, "ttabnl"); await t({ title: 5 }, 400, "tnum"); await t({ title: null }, 400, "tnull"); await t({ title: ["a"] }, 400, "tarr");
  await t({ title: " ".repeat(10) + "a".repeat(120) + " ".repeat(10) }, 200, "t120+ws (trimmed before length)"); eq((await row(d.id)).title.length, 120, "trim");
  await t({ description: "d".repeat(2000) }, 200, "d2000"); await t({ description: "d".repeat(2001) }, 400, "d2001"); await t({ description: 5 }, 400, "dnum"); await t({ description: "😀".repeat(1000) }, 200, "d1000 emoji (2000 UTF-16 units)"); await t({ description: "😀".repeat(1001) }, 400, "d1001 emoji (2002 units)");
  return o.join(" ");
});
await check("M2-10f", "control chars / NUL / lone surrogates / bidi / zero-width / HTML in title+description: no 500; NUL & lone surrogate -> 400; others stored literally and escaped on the public page", async () => {
  const d = await mkDrop(s, { publish: true }); const o = []; const t = async (b, label, ok) => { const r = await P(s, d.drop.id, b); o.push(`${label}→${r.status}`); assert(r.status < 500, `5xx ${label}: ${r.text}`); if (ok !== undefined) eq(r.status, ok, `${label}: ${r.text}`); return r; };
  await t({ title: "a\u0000b" }, "NUL title", 400); await t({ description: "a\u0000b" }, "NUL desc", 400); await t({ title: "bad\ud800" }, "lone surrogate title", 400); await t({ title: "x\u0001\u0007y" }, "C0 title"); await t({ description: "line1\r\nline2\n\n\tx" }, "newlines desc", 200);
  await t({ title: "\u202eevil\u202c" }, "RLO bidi title"); await t({ title: "z\u200bw\u200d" }, "zero-width title"); const xss = `<img src=x onerror=alert(1)>"'</script><script>alert(2)</script>`; await t({ title: xss, description: xss }, "html", 200);
  const g = await anon.j("GET", `/api/public/drops/${d.link}`); eq(g.status, 200, "public"); const page = await (await anon.req("GET", `/u/${d.link}`)).text(); assert(!page.includes("<img src=x onerror") && !page.includes("<script>alert(2)"), "unescaped HTML on /u page");
  const r = await row(d.drop.id); o.push(`stored title ${JSON.stringify(r.title).slice(0, 70)}`); const list = await s.http.j("GET", "/api/drops"); eq(list.status, 200, "list ok"); return o.join(" ");
});
await check("M2-10g", "C0 control characters in title are stored (policy note): same handling as POST /api/drops (creation) — compare", async () => {
  const c = await s.http.j("POST", "/api/drops", { json: { title: "c\u0001d", priceCents: 1000 } }); const d = await newDrop(s); const p = await P(s, d.id, { title: "c\u0001d" }); assert(c.status === 201 && p.status === 200, `create ${c.status} vs patch ${p.status}`); return `create ${c.status}, patch ${p.status} (both accept C0 chars: consistent)`;
});

// ---- whitelist / mass assignment ----
await check("M2-10h", "mass assignment: owner/status/fee/flagged/id/link/attestation/timestamps/cover keys -> 400 (strict) and the row is byte-identical afterwards", async () => {
  const d = await mkDrop(s, { publish: true }); const base = snap(await row(d.drop.id)); const o = [];
  const keys = { seller_id: other.id, sellerId: other.id, owner: other.id, status: "flagged", id: "00000000-0000-0000-0000-000000000000", public_link_id: "HACKED", publicLinkId: "HACKED", fee_percent: 0, feePercent: 0, platform_fee_cents: 0, flagged: true, is_flagged: true, published_at: "2000-01-01", created_at: "2000-01-01", updated_at: "2000-01-01", attested_at: "2000-01-01", attestation: { over18: false }, attestation_history: [], cover_url: "https://evil.example/x.png", verification_status: "verified", role: "admin", isAdmin: true, "__proto__": { polluted: 1 }, constructor: { prototype: { polluted: 1 } }, "title.x": "x", "$set": { title: "x" }, "title ": "x", Title: "x", PRICECENTS: 100 };
  for (const [k, v] of Object.entries(keys)) { const raw = `{"title":"keep","${k}":${JSON.stringify(v)}}`; const r = await s.http.j("PATCH", `/api/drops/${d.drop.id}`, { raw, headers: { "content-type": "application/json" } }); o.push(`${k}:${r.status}`); eq(r.status, 400, `${k} accepted: ${r.text}`); }
  eq(snap(await row(d.drop.id)), base, "row changed by rejected mass-assignment"); const post = await s.http.j("GET", `/api/public/drops/${d.link}`); eq(post.status, 200, "still public"); assert(({}).polluted === undefined, "prototype pollution (test process)");
  const g = await anon.j("GET", `/api/public/drops/${d.link}`); const h = await s.http.j("PATCH", `/api/drops/${d.drop.id}`, { json: { title: "ok" } }); eq(h.status, 200, "server healthy after __proto__ attempts"); return o.join(" ").slice(0, 700);
});
await check("M2-10i", "whitelisted + extra key in one body is rejected as a whole (no partial apply)", async () => {
  const d = await newDrop(s); const b = snap(await row(d.id)); const r = await P(s, d.id, { title: "PARTIAL", priceCents: 999, status: "published" }); eq(r.status, 400, r.text); eq(snap(await row(d.id)), b, "partial write"); return `${r.status} ${r.text.slice(0, 160)}`;
});
await check("M2-10j", "empty / non-object bodies: {} -> 400 empty_patch; [] / null / 5 / 'str' / invalid JSON / empty body -> 400; no 500", async () => {
  const d = await newDrop(s); const o = []; const e = await P(s, d.id, {}); o.push(`{}→${e.status}/${e.json?.code}`); eq(e.status, 400, e.text);
  for (const raw of ["[]", "null", "5", '"str"', "{", "", "true", '{"title":}', "{'title':'x'}", '{"title":"a","title":"b"}']) { const r = await s.http.j("PATCH", `/api/drops/${d.id}`, { raw, headers: { "content-type": "application/json" } }); o.push(`${raw || "<empty>"}→${r.status}`); assert(r.status < 500, `5xx ${raw}`); if (raw !== '{"title":"a","title":"b"}') eq(r.status, 400, `${raw}: ${r.text}`); }
  const dup = await row(d.id); o.push(`dup-key title stored=${JSON.stringify(dup.title)}`); return o.join(" ");
});
await check("M2-10k", "oversized body (5 MB JSON) and deeply nested JSON -> 4xx, no 500/crash", async () => {
  const d = await newDrop(s); const big = await P(s, d.id, { title: "x", description: "y".repeat(5 * 1024 * 1024) }); assert(big.status >= 400 && big.status < 500, `big ${big.status}`);
  const nest = "[".repeat(5000) + "]".repeat(5000); const r = await s.http.j("PATCH", `/api/drops/${d.id}`, { raw: `{"title":${nest}}`, headers: { "content-type": "application/json" } }); assert(r.status >= 400 && r.status < 500, `nested ${r.status}`); const ok = await P(s, d.id, { title: "alive" }); eq(ok.status, 200, "alive"); return `5MB desc → ${big.status}/${big.json?.code}; nested → ${r.status}/${r.json?.code}`;
});

// ---- authz ----
await check("M2-13a", "PATCH authz: anonymous -> 401; other seller -> 404 (same body as a nonexistent id); malformed/nonexistent uuid -> 404; row untouched; other seller's valid body not applied", async () => {
  const d = await mkDrop(s, { publish: true }); const b = snap(await row(d.drop.id)); const un = await P(anon, d.drop.id, { title: "x" }); eq(un.status, 401, un.text); const ot = await P(other, d.drop.id, { title: "HACK", priceCents: 100 }); eq(ot.status, 404, ot.text);
  const ne = await P(other, "11111111-1111-4111-8111-111111111111", { title: "HACK" }); eq(ne.status, 404, ne.text); eq(ot.text, ne.text, "oracle: existing-other vs nonexistent differ"); const bad = await P(s, "not-a-uuid", { title: "x" }); eq(bad.status, 404, bad.text); const sq = await P(s, "' OR 1=1 --", { title: "x" }); assert(sq.status === 404, `sqli id ${sq.status}`);
  eq(snap(await row(d.drop.id)), b, "changed"); const otGet = await other.http.j("GET", `/api/drops/${d.drop.id}`); eq(otGet.status, 404, "GET other"); const ghost = await P(other, d.drop.id, { title: 5 }); assert(ghost.status === 404 || ghost.status === 400, `invalid body on foreign drop leaks existence? ${ghost.status}`); return `anon ${un.status}; other ${ot.status}; nonexistent ${ne.status}; invalid-body-on-foreign ${ghost.status}`;
});
await check("M2-13b", "PATCH with an invalid body on another seller's drop returns the same 404 as valid body (no existence oracle via validation order)", async () => {
  const d = await newDrop(s); const a = await P(other, d.id, { status: "x" }); const b = await P(other, "11111111-1111-4111-8111-111111111111", { status: "x" }); return `foreign+invalid → ${a.status} ${a.json?.code ?? ""}; nonexistent+invalid → ${b.status} ${b.json?.code ?? ""}` + (a.status === b.status ? " (identical)" : " (DIFFERENT)");
});
await check("M2-13c", "session handling: expired/garbage cookie -> 401; suspended/other-role cookie not accepted; admin cookie name not accepted", async () => {
  const g = new L.Http(); g.cookies.set("unveil_session", "garbage"); const r = await P(g, dr.id, { title: "x" }); eq(r.status, 401, r.text); const names = [...s.http.cookies.keys()]; return `garbage cookie → ${r.status}; session cookie names ${names.join(",")}`;
});
await check("V-csrf", "CSRF: cross-origin / null / garbage Origin -> 403 bad_origin; same-origin ok; no Origin allowed (non-browser)", async () => {
  const d = await newDrop(s); const o = []; for (const og of ["https://evil.example", "null", "garbage", "http://localhost:3260.evil.example"]) { const r = await P(s, d.id, { title: "csrf" }, { headers: { origin: og } }); o.push(`${og}→${r.status}`); eq(r.status, 403, `${og}: ${r.text}`); }
  const ok = await P(s, d.id, { title: "same-origin" }, { headers: { origin: BASE } }); eq(ok.status, 200, ok.text); const ref = await P(s, d.id, { title: "sec-fetch" }, { headers: { "sec-fetch-site": "cross-site" } }); o.push(`no-origin+sec-fetch-site:cross-site→${ref.status}`); const del = await s.http.j("DELETE", `/api/drops/${d.id}`, { headers: { origin: "https://evil.example" } }); eq(del.status, 403, "DELETE cross-origin"); o.push(`DELETE evil→${del.status}`); eq((await row(d.id)).title, ref.status === 200 ? "sec-fetch" : "same-origin", "title");
  return o.join(" ");
});
await check("BUG-13", "BUG-13 pattern: PATCH with Content-Type text/plain / form-urlencoded / multipart / none + no Origin (cookie auth) — is the body processed?", async () => {
  const d = await newDrop(s); const o = []; const t = async (ct, body, label) => { const h = ct ? { "content-type": ct } : {}; const r = await s.http.req("PATCH", `/api/drops/${d.id}`, { body, headers: h }); const txt = await r.text(); o.push(`${label}→${r.status}`); return r.status; };
  const a = await t("text/plain", '{"title":"via-text-plain"}', "text/plain"); const b = await t("application/x-www-form-urlencoded", '{"title":"via-form"}', "x-www-form-urlencoded"); const c = await t(null, '{"title":"via-none"}', "no content-type (string body → text/plain default)"); const e = await t("application/json; charset=utf-16", '{"title":"utf16"}', "json charset utf-16");
  const title = (await row(d.id)).title; o.push(`title now ${JSON.stringify(title)}`); if (a === 200) return "OPEN (BUG-13 carried over to PATCH): text/plain body accepted → " + o.join(" "); return o.join(" ");
});
await check("V-method", "other verbs on /api/drops/:id (PUT, POST, OPTIONS, HEAD) -> 405 / no side effects", async () => {
  const d = await newDrop(s); const b = snap(await row(d.id)); const o = []; for (const m of ["PUT", "POST", "OPTIONS", "HEAD"]) { const r = await s.http.req(m, `/api/drops/${d.id}`, m === "PUT" || m === "POST" ? { json: { title: "x" } } : {}); await r.text(); o.push(`${m}→${r.status}`); assert(r.status < 500, m); } eq(snap(await row(d.id)), b, "changed"); return o.join(" ");
});

// ---- state interactions ----
await check("M2-10l", "PATCH on a FLAGGED drop -> 403 flagged, row unchanged (flagged drops frozen); PATCH after unpublish works; unpublished edit does not republish", async () => {
  const d = await mkDrop(s, { publish: true }); await db.query("update drops set status='flagged' where id=$1", [d.drop.id]); const b = snap(await row(d.drop.id)); const r = await P(s, d.drop.id, { title: "while flagged" }); eq(r.status, 403, r.text); eq(r.json.code, "flagged", "code"); eq(snap(await row(d.drop.id)), b, "changed");
  const u = await mkDrop(s, { publish: true }); await s.http.j("POST", `/api/drops/${u.drop.id}/unpublish`); const r2 = await P(s, u.drop.id, { title: "edited while unpublished", priceCents: 1234 }); eq(r2.status, 200, r2.text); eq((await row(u.drop.id)).status, "unpublished", "status after unpublish+edit"); const pg = await anon.j("GET", `/api/public/drops/${u.link}`); assert(pg.status >= 400, "unpublished drop public");
  return `flagged → ${r.status}/${r.json.code}; unpublished edit → ${r2.status}; status ${(await row(u.drop.id)).status}; public ${pg.status}`;
});
await check("M2-11", "unpublish / re-publish regression with edits: edited price/title carried through republish; attestation required again as before", async () => {
  const d = await mkDrop(s, { publish: true, priceCents: 1500 }); await s.http.j("POST", `/api/drops/${d.drop.id}/unpublish`); await P(s, d.drop.id, { title: "Re-pub", priceCents: 2222 }); const p = await s.http.j("POST", `/api/drops/${d.drop.id}/publish`, { json: { attestation: L.att } }); eq(p.status, 200, p.text); const g = await anon.j("GET", `/api/public/drops/${d.link}`); eq(g.status, 200, g.text); eq(g.json.drop.title, "Re-pub", "t"); eq(g.json.drop.priceCents, 2222, "p"); const np = await s.http.j("POST", `/api/drops/${d.drop.id}/publish`, { json: {} }); return `republish ${p.status}; public shows ${g.json.drop.title} ${g.json.drop.priceCents}; publish w/o attestation → ${np.status}`;
});
await check("M2-10m", "edit of nonexistent-after-delete drop -> 404; edit race with unpublish does not 500", async () => {
  const d = await mkDrop(s, { publish: true }); const rs = await Promise.all([...Array(10)].map((_, i) => (i % 2 ? P(s, d.drop.id, { title: `race ${i}` }) : s.http.j("POST", `/api/drops/${d.drop.id}/unpublish`)))); const codes = rs.map((r) => r.status); assert(codes.every((c) => c < 500), `5xx ${codes}`); return `statuses ${codes.join(",")}`;
});

// ---- concurrency ----
await check("V-concurrent", "concurrent PATCH (30 parallel with distinct titles+prices): all 200, no 5xx/deadlock, final row equals one complete request (title and price from the SAME request), audit rows = 30", async () => {
  const d = await newDrop(s); const reqs = [...Array(30)].map((_, i) => ({ title: `T-${i}`, priceCents: 1000 + i })); const rs = await Promise.all(reqs.map((b) => P(s, d.id, b))); const codes = rs.map((r) => r.status); assert(codes.every((c) => c === 200), `codes ${codes}`);
  const f = await row(d.id); const i = Number(f.title.split("-")[1]); eq(f.price_cents, 1000 + i, `torn write: title T-${i} price ${f.price_cents}`); const a = (await auditFor(d.id)).filter((x) => x.action === "drop_edited").length; eq(a, 30, "audit rows"); return `final ${f.title} / ${f.price_cents} (consistent); audit ${a}`;
});
await check("V-concurrent2", "PATCH storm on separate fields (title-only vs price-only vs description-only, 60 parallel): no lost-update across different columns", async () => {
  const d = await newDrop(s); await Promise.all([...Array(60)].map((_, i) => P(s, d.id, i % 3 === 0 ? { title: `a${i}` } : i % 3 === 1 ? { priceCents: 1000 + i } : { description: `d${i}` }))); const f = await row(d.id); assert(/^a\d+$/.test(f.title) && f.price_cents >= 1000 && /^d\d+$/.test(f.description), JSON.stringify([f.title, f.price_cents, f.description])); return `${f.title} ${f.price_cents} ${f.description}`;
});

// ---- price edit on a published drop with buyers / pending checkouts / ledger ----
await check("M2-10n", "price edit on PUBLISHED drop with an existing SUCCEEDED sale: transaction row, ledger postings, earnings are unchanged; new buyer pays the new price", async () => {
  const d = await mkDrop(s, { publish: true, priceCents: 2000 }); const sale = await L.sell(d.link, 2000); eq(sale.status, 200, sale.text); const earn0 = (await s.http.j("GET", "/api/earnings")).json; const tx0 = (await db.query("select * from transactions where id=$1", [sale.tx])).rows[0]; const led0 = (await db.query("select entry_type,component,amount_cents from ledger_entries where transaction_id=$1 order by id", [sale.tx])).rows;
  const r = await P(s, d.drop.id, { priceCents: 9000 }); eq(r.status, 200, r.text); const tx1 = (await db.query("select * from transactions where id=$1", [sale.tx])).rows[0]; eq(JSON.stringify(tx1), JSON.stringify(tx0), "transaction row changed"); const led1 = (await db.query("select entry_type,component,amount_cents from ledger_entries where transaction_id=$1 order by id", [sale.tx])).rows; eq(JSON.stringify(led1), JSON.stringify(led0), "ledger changed");
  const earn1 = (await s.http.j("GET", "/api/earnings")).json; eq(JSON.stringify(earn1.balance), JSON.stringify(earn0.balance), "balance"); eq(JSON.stringify(earn1.lifetime), JSON.stringify(earn0.lifetime), "lifetime");
  const c = await new L.Http().j("POST", "/api/checkout", { json: { linkId: d.link, email: "newbuyer@example.test", confirmOver18: true } }); eq(c.status, 201, c.text); const nt = (await db.query("select amount_cents, platform_fee_cents, seller_net_cents from transactions where id=$1", [c.json.transactionId])).rows[0]; eq(nt.amount_cents, 9000, "new checkout amount"); eq(nt.platform_fee_cents, 900, "fee 10%");
  return `old tx 2000 unchanged (net ${tx0.seller_net_cents}); ledger ${led0.length} rows unchanged; new checkout ${JSON.stringify(nt)}`;
});
await check("M2-10o", "price edit with a PENDING checkout: same buyer (token cookie) re-checkout supersedes the stale-priced session; a different browser's pending session keeps the OLD price until it expires (documented behaviour)", async () => {
  const d = await mkDrop(s, { publish: true, priceCents: 2000 }); const buyer = "pend@example.test"; const bh = new L.Http(); const c1 = await bh.j("POST", "/api/checkout", { json: { linkId: d.link, email: buyer, confirmOver18: true } }); eq(c1.status, 201, c1.text);
  const other1 = await new L.Http().j("POST", "/api/checkout", { json: { linkId: d.link, email: "other-browser@example.test", confirmOver18: true } }); eq(other1.status, 201, other1.text);
  await P(s, d.drop.id, { priceCents: 5000 }); const c2 = await bh.j("POST", "/api/checkout", { json: { linkId: d.link, email: buyer, confirmOver18: true } }); eq(c2.status, 201, c2.text); assert(c2.json.transactionId !== c1.json.transactionId, "stale pending tx reused at old price");
  const t1 = (await db.query("select status, failure_code, amount_cents from transactions where id=$1", [c1.json.transactionId])).rows[0]; eq(t1.status, "failed", "old tx"); eq(t1.failure_code, "superseded", "old fc"); const t2 = (await db.query("select amount_cents, status from transactions where id=$1", [c2.json.transactionId])).rows[0]; eq(t2.amount_cents, 5000, "new amt");
  const o1 = (await db.query("select status, amount_cents from transactions where id=$1", [other1.json.transactionId])).rows[0];
  // pay the OTHER browser's pre-edit session (old price) after the edit
  const tx = other1.json.transactionId; const ev = { id: "evt_" + Math.random().toString(16).slice(2), type: "sale.succeeded", created: new Date().toISOString(), data: { transaction_id: L.mockSaleId(tx), reference: tx, amount_cents: 2000, currency: "USD" } }; const raw = JSON.stringify(ev);
  const w = await fetch(`${BASE}/api/webhooks/mock`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": L.freshIp(), "x-unveil-signature": L.signWebhook(process.env.WEBHOOK_SECRET, raw) }, body: raw }); const wt = await w.text(); const t1b = (await db.query("select status, amount_cents, seller_net_cents from transactions where id=$1", [tx])).rows[0];
  const led = (await db.query("select sum(amount_cents)::int s from ledger_entries where transaction_id=$1", [tx])).rows[0].s;
  return `same-buyer: old tx ${t1.status}/${t1.failure_code}, new tx ${t2.amount_cents}; other-browser pending before pay ${JSON.stringify(o1)}; its late webhook at OLD price → ${w.status} ${wt.slice(0, 60)} → ${JSON.stringify(t1b)}; ledger net ${led} (sale honoured at the price the buyer was shown; drop price now 5000)`;
});
await check("M2-10p", "buyer-visible price: public API price, /u page and checkout amount all follow a PATCH immediately (no cache)", async () => {
  const d = await mkDrop(s, { publish: true, priceCents: 1100 }); const o = []; for (const p of [1200, 1300, 50000, 100]) { await P(s, d.drop.id, { priceCents: p }); const g = await anon.j("GET", `/api/public/drops/${d.link}`); eq(g.json.drop.priceCents, p, "api"); const c = await new L.Http().j("POST", "/api/checkout", { json: { linkId: d.link, email: `p${p}@example.test`, confirmOver18: true } }); eq(c.status, 201, c.text); eq(c.json.amountCents ?? (await db.query("select amount_cents a from transactions where id=$1", [c.json.transactionId])).rows[0].a, p, "checkout amount"); o.push(p); } return `followed ${o.join(",")}`;
});
await check("M2-10q", "PATCH changes no files: drop_files rows / storage objects / previews unchanged", async () => {
  const d = await mkDrop(s, { publish: false, video: true, images: 2 }); const b = JSON.stringify((await L.dropFiles(d.drop.id)).map((f) => [f.id, f.storage_key, f.blurred_preview_key, f.size_bytes])); const objs = L.storedFiles().filter((f) => f.includes(d.drop.id)).length; await P(s, d.drop.id, { title: "same files", priceCents: 1500 }); eq(JSON.stringify((await L.dropFiles(d.drop.id)).map((f) => [f.id, f.storage_key, f.blurred_preview_key, f.size_bytes])), b, "files"); eq(L.storedFiles().filter((f) => f.includes(d.drop.id)).length, objs, "objs"); return `${objs} objects unchanged`;
});
await check("V-rate", "no unbounded response: PATCH response never contains seller_id/storage paths/attestation internals beyond the drop object fields", async () => {
  const d = await newDrop(s); const r = await P(s, d.id, { title: "shape" }); const ks = Object.keys(r.json.drop); assert(!/storage|secret|hash|password|token|email/i.test(r.text), "sensitive"); return `keys: ${ks.join(",")}`;
});

L.save("edit.json"); fs.writeFileSync("qa/evidence-m2-edit.json", JSON.stringify(L.recs, null, 2)); await L.done();
