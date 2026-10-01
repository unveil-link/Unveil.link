// @ts-nocheck
/* eslint-disable */
// Round 4 QA, item 1 (NEW-2): systematic fuzz of EVERY route (api + page) with hostile input. Expect 4xx/2xx(valid-only), never 5xx; no state change on 4xx.
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";
import { Http, BASE, db, makeSeller, makeDrop, checkout, signPayload, SECRET, mockEvents, stamp, freshIp, ART, sleep } from "./qa-pay5-lib";

const PW = "Qa-Admin-Passphrase-93!x";
const cli = (args: string[], env: Record<string, string> = {}) => { const e: any = { ...process.env, ...env }; return spawnSync("npx", ["tsx", "scripts/create-admin.ts", ...args], { env: e, encoding: "utf8", input: "" }); };

// ---------- payload corpora ----------
const STR: [string, string][] = [
  ["nul", "a\u0000b"], ["nul-only", "\u0000"], ["nul-1000", "\u0000".repeat(1000)], ["lone-hi", "a\ud800b"], ["lone-lo", "\udc00"], ["lone-hi-end", "x\ud83d"],
  ["len513", "a".repeat(513)], ["len5000", "a".repeat(5000)], ["len200k", "a".repeat(200000)], ["dash36", "-".repeat(36)], ["uuid-bad-hex", "00000000-0000-0000-0000-00000000000g"],
  ["uuid-nil", "00000000-0000-0000-0000-000000000000"], ["uuid-trailing-space", "00000000-0000-0000-0000-000000000000 "], ["uuid-braces", "{00000000-0000-0000-0000-000000000000}"], ["uuid-nodash", "0".repeat(32)],
  ["emoji", "😀".repeat(30)], ["emoji-zwj", "👨‍👩‍👧‍👦"], ["rtl", "a\u202eb"], ["nfd", "e\u0301"], ["fullwidth", "ｕｎｖｅｉｌ＠ｅｘａｍｐｌｅ．ｔｅｓｔ"],
  ["homoglyph-email", "аdmin@exаmple.test"], ["sqli", "' OR 1=1--"], ["xss", "<script>alert(1)</script>"], ["pct00", "%00"], ["traversal", "../../etc/passwd"], ["crlf", "a\r\nX-Injected: 1"],
  ["tmpl", "${7*7}{{7*7}}"], ["proto", "__proto__"], ["empty", ""], ["space", "   "], ["tab", "\t"], ["bom", "\ufeffabc"], ["bigemail", "a".repeat(300) + "@example.test"], ["localpart64+", "a".repeat(70) + "@example.test"],
  ["email-nul", "a\u0000@example.test"], ["email-surr", "a\ud800@example.test"], ["email-emoji", "😀@example.test"], ["long-pw", "Aa1!".repeat(5000)], ["json-in-str", "{\"a\":1}"],
];
const NONSTR: [string, any][] = [["null", null], ["true", true], ["false", false], ["zero", 0], ["neg", -1], ["float", 1.5], ["1e21", 1e21], ["maxint", 9007199254740993], ["arr-empty", []], ["arr-str", ["a"]], ["obj-empty", {}], ["obj", { a: 1 }], ["obj-proto", { __proto__: { x: 1 }, constructor: { prototype: 1 } }], ["arr-nested", [[[[[]]]]]]];
const ALLV = [...STR.map(([n, v]) => ["s:" + n, v]), ...NONSTR.map(([n, v]) => ["t:" + n, v])] as [string, any][];
const deep = (n: number) => { let s = "1"; for (let i = 0; i < n; i++) s = `{"a":${s}}`; return s; };
const deepArr = (n: number) => "[".repeat(n) + "]".repeat(n);

// ---------- state snapshot (detect state change on rejected requests) ----------
const SNAP_SQL = `SELECT
 (SELECT count(*) FROM sellers)||'|'||(SELECT count(*) FROM drops)||'|'||(SELECT count(*) FROM drop_files)||'|'||(SELECT count(*) FROM transactions)||'|'||(SELECT count(*) FROM ledger_entries)||'|'||(SELECT count(*) FROM payouts)||'|'||
 (SELECT count(*) FROM admins)||'|'||(SELECT count(*) FROM admin_sessions)||'|'||(SELECT count(*) FROM sessions)||'|'||(SELECT count(*) FROM password_reset_tokens)||'|'||
 (SELECT count(*) FROM audit_log WHERE action NOT IN ('admin_login_failed','admin_login_flood'))||'|'||
 md5(coalesce((SELECT string_agg(d::text, ',' ORDER BY d.id) FROM drops d),''))||md5(coalesce((SELECT string_agg(s::text, ',' ORDER BY s.id) FROM sellers s),''))||md5(coalesce((SELECT string_agg(t::text, ',' ORDER BY t.id) FROM transactions t),'')) AS s`;
const snap = async () => (await db.query(SNAP_SQL)).rows[0].s as string;

interface Rec { route: string; payload: string; status: number; note?: string }
const results: Rec[] = []; const fives: Rec[] = []; const stateChanges: Rec[] = []; const unexpected2xx: Rec[] = []; let total = 0;
const histo: Record<string, number> = {}; const twoxx: Rec[] = [];
async function probe(route: string, payload: string, fn: () => Promise<{ status: number; text?: string }>, o: { expect2xx?: boolean } = {}) {
  const before = await snap(); let r: { status: number; text?: string };
  try { r = await fn(); } catch (e) { r = { status: -1, text: String(e) }; }
  const after = await snap(); total++;
  const key = `${route} -> ${r.status}`; histo[key] = (histo[key] ?? 0) + 1;
  const rec: Rec = { route, payload: payload.slice(0, 120), status: r.status }; if (r.status >= 200 && r.status < 300) twoxx.push(rec);
  if (r.status >= 500 || r.status === -1) { fives.push({ ...rec, note: (r.text ?? "").slice(0, 160) }); }
  if (r.status >= 400 && before !== after) stateChanges.push(rec);
  if (r.status >= 200 && r.status < 300 && !o.expect2xx) unexpected2xx.push(rec);
  return r;
}

(async () => {
  await db.query("select 1");
  const seller = await makeSeller("fz"); const other = await makeSeller("fz2");
  const drop = await makeDrop(seller, 2500); const fileId = (await db.query("SELECT id FROM drop_files WHERE drop_id=$1", [drop.id])).rows[0].id;
  const draft = await seller.http.json("POST", "/api/drops", { json: { title: "draft", priceCents: 1000 } }); const draftId = draft.json.drop.id;
  const co = await checkout(drop.link, {}, new Http()); const txId = co.json.transactionId; const sessId = co.json.sessionId ?? (await db.query("SELECT provider_session_id s FROM transactions WHERE id=$1", [txId])).rows[0].s;
  const flagged = await makeSeller("fzflag"); await db.query("UPDATE sellers SET risk_flagged_at=now() WHERE id=$1", [flagged.id]);
  const adminEmail = `adm-fz-${stamp}@example.test`; const c = cli([adminEmail], { ADMIN_PASSWORD: PW }); if (c.status !== 0) throw new Error("create-admin " + c.stdout + c.stderr);
  const admin = new Http(); const lg = await admin.json("POST", "/api/admin/login", { json: { email: adminEmail, password: PW } }); if (lg.status !== 200) throw new Error("admin login " + lg.text);
  const anon = () => new Http();
  const J = (h: Http, method: string, path: string, body: any, headers: Record<string, string> = {}) => h.json(method, path, { json: body, headers });
  const RAW = (h: Http, method: string, path: string, raw: string, headers: Record<string, string> = {}) => h.json(method, path, { raw, headers });
  const enc = (v: string) => { let o = ""; for (const ch of v.replace(/[\ud800-\udfff]/g, (m, i, str) => m)) { try { o += encodeURIComponent(ch); } catch { o += "%" + (0xE0 | (ch.charCodeAt(0) >> 12)).toString(16) + "%" + (0x80 | ((ch.charCodeAt(0) >> 6) & 63)).toString(16) + "%" + (0x80 | (ch.charCodeAt(0) & 63)).toString(16); } } return o; }; // lone surrogates -> WTF-8 bytes
  const sigWebhook = async (raw: string) => { const t = Math.floor(Date.now() / 1000); const r = await fetch(`${BASE}/api/webhooks/mock`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), "x-unveil-signature": signPayload(SECRET, raw, t) }, body: raw }); return { status: r.status, text: await r.text() }; };

  // =============== A. JSON-body routes: every field x every payload ===============
  let uniq = 0; const em = () => `fz${++uniq}+${stamp}@example.test`;
  const JSON_ROUTES: { name: string; method: string; path: () => string; http: () => Http; base: () => any; fields: string[]; headers?: Record<string, string> }[] = [
    { name: "POST /api/auth/signup", method: "POST", path: () => "/api/auth/signup", http: anon, base: () => ({ email: em(), password: "Qa-Pay-Passw0rd!x", displayName: "Fz" }), fields: ["email", "password", "displayName"] },
    { name: "POST /api/auth/login", method: "POST", path: () => "/api/auth/login", http: anon, base: () => ({ email: seller.email, password: "wrong-password-123" }), fields: ["email", "password"] },
    { name: "POST /api/auth/forgot-password", method: "POST", path: () => "/api/auth/forgot-password", http: anon, base: () => ({ email: em() }), fields: ["email"] },
    { name: "POST /api/auth/reset-password", method: "POST", path: () => "/api/auth/reset-password", http: anon, base: () => ({ token: "t".repeat(40), password: "Qa-Pay-Passw0rd!x" }), fields: ["token", "password"] },
    { name: "POST /api/drops", method: "POST", path: () => "/api/drops", http: () => seller.http, base: () => ({ title: "fuzz", description: "d", priceCents: 1000 }), fields: ["title", "description", "priceCents"] },
    { name: "POST /api/drops/:id/publish", method: "POST", path: () => `/api/drops/${draftId}/publish`, http: () => seller.http, base: () => ({ attestation: { over18: true, ownsRights: true, consentOfSubjects: true } }), fields: ["attestation", "attestation.over18", "attestation.ownsRights", "attestation.consentOfSubjects"] },
    { name: "POST /api/checkout", method: "POST", path: () => "/api/checkout", http: anon, base: () => ({ linkId: drop.link, email: em(), confirmOver18: true }), fields: ["linkId", "email", "confirmOver18", "dropId"] },
    { name: "POST /api/dev/payments/pay", method: "POST", path: () => "/api/dev/payments/pay", http: anon, base: () => ({ sessionId: sessId, card: "4242424242424242" }), fields: ["sessionId", "card"] },
    { name: "POST /api/dev/payments/refund", method: "POST", path: () => "/api/dev/payments/refund", http: anon, base: () => ({ transactionId: txId }), fields: ["transactionId", "amountCents"] },
    { name: "POST /api/admin/login", method: "POST", path: () => "/api/admin/login", http: anon, base: () => ({ email: `nobody-${++uniq}-${stamp}@example.test`, password: "wrong-password-123" }), fields: ["email", "password"] },
    { name: "POST /api/admin/sellers/:id/clear-flag", method: "POST", path: () => `/api/admin/sellers/${flagged.id}/clear-flag`, http: () => admin, base: () => ({ note: "reviewed ok" }), fields: ["note"] },
  ];
  for (const r of JSON_ROUTES) {
    for (const f of r.fields) for (const [pn, pv] of ALLV) {
      const body = r.base(); if (f.includes(".")) { const [a, b] = f.split("."); body[a][b] = pv; } else body[f] = pv;
      let ser: string; try { ser = JSON.stringify(body); } catch { continue; }
      await probe(r.name, `${f}=${pn}`, () => RAW(r.http(), r.method, r.path(), ser, { "content-type": "application/json" }), { expect2xx: true });
    }
    // missing field entirely
    for (const f of r.fields) { const body = r.base(); if (!f.includes(".")) delete body[f]; await probe(r.name, `missing:${f}`, () => J(r.http(), r.method, r.path(), body), { expect2xx: true }); }
    // structural/body-level
    const structural: [string, string, string?][] = [
      ["invalid-json", "{"], ["empty-body", ""], ["null", "null"], ["array", "[]"], ["number", "123"], ["string", "\"x\""], ["true", "true"], ["bom-json", "\ufeff{}"], ["trailing-comma", "{\"a\":1,}"],
      ["deep-9", deep(9)], ["deep-50", deep(50)], ["deep-5000", deep(5000)], ["deep-arr-100000", deepArr(100000)], ["proto-key", "{\"__proto__\":{\"x\":1},\"constructor\":{\"prototype\":{\"y\":2}}}"],
      ["dup-keys", "{\"email\":\"a@b.co\",\"email\":\"c\\u0000d\"}"], ["1e999", "{\"priceCents\":1e999,\"amountCents\":1e999}"], ["-0", "{\"priceCents\":-0}"], ["bignum", `{"priceCents":${"9".repeat(400)}}`],
      ["nul-key", "{\"a\\u0000b\":1}"], ["surr-key", "{\"a\\ud800\":1}"], ["escaped-nul-val", "{\"email\":\"x\\u0000\"}"], ["raw-invalid-utf8", "{\"email\":\"\u0080\"}"], ["big-300k", "{\"email\":\"" + "a".repeat(300000) + "\"}"],
      ["big-3MB", "{\"x\":\"" + "a".repeat(3_000_000) + "\"}"], ["array-of-100k", "[" + "1,".repeat(100000) + "1]"],
    ];
    for (const [n, s] of structural) await probe(r.name, `body:${n}`, () => RAW(r.http(), r.method, r.path(), s, { "content-type": "application/json" }), { expect2xx: false });
    // wrong content-types with a *valid-looking* body
    const vb = JSON.stringify(r.base());
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "multipart/form-data; boundary=", "application/xml", "application/json; charset=utf-16", "application/json;charset=\"", "", "application/jsonx", "text/html", "*/*", "application/x-www-form-urlencoded; a=b"])
      await probe(r.name, `ct:${ct || "(none)"}`, () => r.http().json(r.method, r.path(), { raw: vb, headers: ct ? { "content-type": ct } : { "content-type": "" } }), { expect2xx: true });
    // form-encoded actual body
    await probe(r.name, "form-body", () => r.http().json(r.method, r.path(), { raw: "email=a%00b&password=x", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    // wrong methods
    for (const m of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) await probe(r.name, `method:${m}`, () => r.http().json(m, r.path(), {}), { expect2xx: true });
  }

  // =============== B. GET/other routes with query / path params ===============
  const GETS: { name: string; mk: (p: string, rawv: string) => string; http: () => Http; method?: string }[] = [
    { name: "GET /api/checkout/status?id=", mk: (p) => `/api/checkout/status?id=${p}`, http: anon },
    { name: "GET /api/files/:id/original?exp&sig", mk: (p) => `/api/files/${fileId}/original?exp=${p}&sig=${p}`, http: anon },
    { name: "GET /api/files/:id/original (id)", mk: (p) => `/api/files/${p}/original?exp=${Math.floor(Date.now() / 1000) + 100}&sig=abc`, http: anon },
    { name: "GET /api/files/:id/preview", mk: (p) => `/api/files/${p}/preview`, http: anon },
    { name: "POST /api/files/:id/signed-url", mk: (p) => `/api/files/${p}/signed-url`, http: () => seller.http, method: "POST" },
    { name: "GET /api/public/drops/:linkId", mk: (p) => `/api/public/drops/${p}`, http: anon },
    { name: "GET /api/drops/:id", mk: (p) => `/api/drops/${p}`, http: () => seller.http },
    { name: "POST /api/drops/:id/publish (id)", mk: (p) => `/api/drops/${p}/publish`, http: () => seller.http, method: "POST" },
    { name: "POST /api/drops/:id/unpublish", mk: (p) => `/api/drops/${p}/unpublish`, http: () => seller.http, method: "POST" },
    { name: "POST /api/drops/:id/files (id)", mk: (p) => `/api/drops/${p}/files`, http: () => seller.http, method: "POST" },
    { name: "POST /api/webhooks/:provider", mk: (p) => `/api/webhooks/${p}`, http: anon, method: "POST" },
    { name: "POST /api/admin/sellers/:id/clear-flag (id)", mk: (p) => `/api/admin/sellers/${p}/clear-flag`, http: () => admin, method: "POST" },
    { name: "PAGE /u/:linkId", mk: (p) => `/u/${p}`, http: anon },
    { name: "PAGE /pay/mock/:sessionId", mk: (p) => `/pay/mock/${p}`, http: anon },
    { name: "PAGE /dashboard/drops/:id", mk: (p) => `/dashboard/drops/${p}`, http: () => seller.http },
    { name: "PAGE /admin/sellers/:id/transactions", mk: (p) => `/admin/sellers/${p}/transactions`, http: () => admin },
    { name: "PAGE /reset-password?token=", mk: (p) => `/reset-password?token=${p}`, http: anon },
    { name: "PAGE /login?error=", mk: (p) => `/login?error=${p}&next=${p}`, http: anon },
    { name: "GET /api/auth/google/callback", mk: (p) => `/api/auth/google/callback?code=${p}&state=${p}&error=${p}`, http: anon },
  ];
  const PATHV: [string, string][] = [...STR.filter(([, v]) => v.length < 100000).map(([n, v]) => ["s:" + n, enc(v)] as [string, string]),
    ["raw-%ff", "%ff%fe"], ["raw-%c0%af", "%c0%af"], ["%zz", "%zz"], ["%", "%"], ["%00x", "%00x"], ["%2e%2e", "%2e%2e"], ["..%2f", "..%2f"], ["%2f", "%2f"], ["%5c", "%5c"], ["%ed%a0%80(surrogate utf8)", "%ed%a0%80"], ["uuid-valid-nonexistent", "00000000-0000-0000-0000-000000000000"],
    ["len70k", "a".repeat(70000)], ["dots", "."], ["dotdot", ".."], ["semicolon", "a;b"], ["question", "a%3Fb"], ["hash", "a%23b"]];
  for (const g of GETS) for (const [pn, pv] of PATHV) {
    await probe(g.name, `path=${pn}`, () => g.http().json(g.method ?? "GET", g.mk(pv, pv), g.method === "POST" ? { raw: "{}", headers: { "content-type": "application/json" } } : {}), { expect2xx: true });
  }

  // =============== C. webhooks: signed event field fuzz + raw variants ===============
  const baseEv = () => mockEvents.saleSucceeded({ transactionId: txId, amountCents: 2500 });
  const evPaths = ["id", "type", "created", "data", "data.transaction_id", "data.related_transaction_id", "data.reference", "data.amount_cents", "data.currency", "data.failure_code"];
  for (const p of evPaths) for (const [pn, pv] of ALLV) {
    const ev: any = JSON.parse(JSON.stringify(baseEv())); if (p.includes(".")) { const [a, b] = p.split("."); ev[a][b] = pv; } else ev[p] = pv; if (p === "data.reference" || p === "data.transaction_id") { /* keep */ }
    let ser: string; try { ser = JSON.stringify(ev); } catch { continue; }
    await probe("POST /api/webhooks/mock (signed)", `${p}=${pn}`, () => sigWebhook(ser), { expect2xx: true });
  }
  for (const [n, s] of [["invalid-json", "{"], ["empty", ""], ["null", "null"], ["array", "[]"], ["deep-5000", deep(5000)], ["nul-in-raw", "{\"id\":\"a\u0000\"}"], ["huge-300k", "{\"id\":\"" + "a".repeat(300000) + "\"}"], ["huge-2MB", "{\"id\":\"" + "a".repeat(2_000_000) + "\"}"], ["unknown-type", JSON.stringify({ id: "e1", type: "weird.event", created: new Date().toISOString(), data: {} })]] as [string, string][])
    await probe("POST /api/webhooks/mock (signed raw)", n, () => sigWebhook(s), { expect2xx: true });
  for (const sig of ["", "garbage", "t=1,v1=zz", "t=99999999999999999999,v1=ab", "t=-1,v1=", "a".repeat(10000), "t=" + Math.floor(Date.now() / 1000) + ",v1=" + "0".repeat(64), "t=0", "t=NaN,v1=x", ",,,", "t=1,t=2,v1=x"])
    await probe("POST /api/webhooks/mock (sig hdr)", `sig:${sig.slice(0, 30)}`, () => anon().json("POST", "/api/webhooks/mock", { raw: JSON.stringify(baseEv()), headers: { "content-type": "application/json", "x-unveil-signature": sig } }));
  for (const prov of ["mock", "MOCK", "nope", "..", "mock%2f", "", enc("a\u0000"), "x".repeat(5000)]) await probe("POST /api/webhooks/:provider (name)", prov.slice(0, 20), () => anon().json("POST", `/api/webhooks/${prov}`, { raw: "{}", headers: { "content-type": "application/json" } }));

  // =============== D. headers: cookies, origin, auth, idempotency-key, xff ===============
  const tok = seller.http.cookies.get("unveil_session"); const atok = admin.cookies.get("unveil_admin");
  const cookieVals: [string, string][] = [["empty", ""], ["garbage", "garbage"], ["three-dots", "a.b.c"], ["jwt-trunc", tok!.slice(0, 40)], ["jwt-flip", tok!.slice(0, -2) + "xx"], ["huge-8k", "a".repeat(8000)], ["quote", "\""], ["percent", "%00%ff"], ["semicolons", "a=b;;;=;c"], ["latin1", "\xe9\xe9"], ["many", Array.from({ length: 300 }, (_, i) => `k${i}=v`).join("; ")], ["admin-tok-as-seller", atok!], ["seller-tok-as-admin", tok!]];
  for (const [n, v] of cookieVals) for (const nm of ["unveil_session", "unveil_admin", "unveil_buyer"]) {
    for (const [route, m, path, body] of [["/api/auth/me", "GET", "/api/auth/me", null], ["/api/admin/me", "GET", "/api/admin/me", null], ["/api/checkout", "POST", "/api/checkout", { linkId: drop.link, email: em(), confirmOver18: true }], ["/admin/sellers/flagged", "GET", "/admin/sellers/flagged", null], ["/dashboard", "GET", "/dashboard", null], ["/api/admin/sellers/flagged", "GET", "/api/admin/sellers/flagged", null], ["/api/earnings", "GET", "/api/earnings", null]] as any[]) {
      await probe(`cookie ${m} ${route}`, `${nm}=${n}`, () => fetch(BASE + path, { method: m, redirect: "manual", headers: { cookie: `${nm}=${v}`, "x-forwarded-for": freshIp(), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, text: (await r.text()).slice(0, 100) })), { expect2xx: true });
    }
  }
  for (const o of ["null", "", "http://", "http://[::1", "javascript:alert(1)", "http://localhost:3917.evil.test", "http://evil.test", "https://localhost:3917", "http://localhost:3917/path", "http://LOCALHOST:3917", "a".repeat(10000), "http://localhost:3917\u0000", "file:///", "data:text/html,x"]) {
    for (const [route, path, body, h] of [["/api/admin/login", "/api/admin/login", { email: "nobody@example.test", password: "x" }, anon()], ["/api/admin/sellers/:id/clear-flag", `/api/admin/sellers/${flagged.id}/clear-flag`, { note: "n" }, admin], ["/api/drops", "/api/drops", { title: "o", priceCents: 1000 }, seller.http], ["/api/auth/logout", "/api/auth/logout", {}, anon()]] as any[])
      await probe(`origin POST ${route}`, `Origin:${o.slice(0, 40)}`, () => h.json("POST", path, { json: body, headers: { origin: o } }), { expect2xx: true });
  }
  for (const a of ["", "Bearer", "Bearer ", "bearer x", "Bearer " + "a".repeat(10000), "Basic Zm9vOmJhcg==", "Bearer a b", "Bearer \u00e9", "x".repeat(70000)])
    for (const m of ["GET", "POST"]) await probe(`cron ${m}`, `Authorization:${a.slice(0, 30)}`, () => anon().json(m, "/api/internal/cron/payments-janitor", { headers: { authorization: a } }));
  for (const k of ["", "a".repeat(5000), "k\u00e9y", "k ey", "\"quoted\"", "k".repeat(129)]) await probe("POST /api/checkout (Idempotency-Key)", `key:${k.slice(0, 20)}(${k.length})`, () => anon().json("POST", "/api/checkout", { json: { linkId: drop.link, email: em(), confirmOver18: true }, headers: { "idempotency-key": k } }), { expect2xx: true });
  for (const x of ["", "1.1.1.1, ".repeat(2000), "not-an-ip", "\u00e9", ",,,", "::ffff:1.2.3.4", "999.999.999.999", "a".repeat(5000), "[::1]:80"]) {
    await probe("POST /api/admin/login (XFF)", `xff:${x.slice(0, 20)}`, () => fetch(BASE + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": x }, body: JSON.stringify({ email: `xff${++uniq}-${stamp}@example.test`, password: "x" }) }).then(async (r) => ({ status: r.status, text: await r.text() })));
    await probe("POST /api/checkout (XFF)", `xff:${x.slice(0, 20)}`, () => fetch(BASE + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": x }, body: JSON.stringify({ linkId: drop.link, email: em(), confirmOver18: true }) }).then(async (r) => ({ status: r.status, text: await r.text() })), { expect2xx: true });
  }

  // =============== E. multipart upload ===============
  const png1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const up = (name: string, data: Buffer | string, type = "image/png", fname?: string) => { const f = new FormData(); f.append(name, new Blob([data as any], { type }), fname ?? "a.png"); return f; };
  const uploads: [string, () => { form?: FormData; raw?: string; headers?: Record<string, string> }][] = [
    ["ok-png", () => ({ form: up("file", png1) })], ["fname-nul", () => ({ form: up("file", png1, "image/png", "a\u0000b.png") })], ["fname-surr", () => ({ form: up("file", png1, "image/png", "a\ud800.png") })], ["fname-long", () => ({ form: up("file", png1, "image/png", "a".repeat(5000) + ".png") })],
    ["fname-traversal", () => ({ form: up("file", png1, "image/png", "../../etc/passwd") })], ["fname-quote-crlf", () => ({ form: up("file", png1, "image/png", "a\"\r\nX: y.png") })], ["fname-emoji", () => ({ form: up("file", png1, "image/png", "😀.png") })],
    ["wrong-field", () => ({ form: up("nofile", png1) })], ["empty-file", () => ({ form: up("file", Buffer.alloc(0)) })], ["text-as-png", () => ({ form: up("file", "hello", "image/png") })], ["mime-nul", () => ({ form: up("file", png1, "image/png\u0000x") })],
    ["mime-long", () => ({ form: up("file", png1, "image/" + "x".repeat(5000)) })], ["svg", () => ({ form: up("file", "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "image/svg+xml", "a.svg") })], ["polyglot", () => ({ form: up("file", Buffer.concat([png1, Buffer.from("<?php echo 1;")]), "image/png") })],
    ["bad-multipart", () => ({ raw: "--x\r\nbroken", headers: { "content-type": "multipart/form-data; boundary=x" } })], ["no-boundary", () => ({ raw: "abc", headers: { "content-type": "multipart/form-data" } })], ["json-as-upload", () => ({ raw: "{}", headers: { "content-type": "application/json" } })],
    ["big-30MB", () => ({ form: up("file", Buffer.alloc(30 * 1024 * 1024, 1)) })], ["huge-declared", () => ({ form: up("file", png1), headers: { "content-length": "999999999999" } })], ["cl-mismatch", () => ({ raw: "short", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "5" } })],
  ];
  for (const [n, mk] of uploads) await probe("POST /api/drops/:id/files", `upload:${n}`, () => { const o = mk(); return seller.http.json("POST", `/api/drops/${draftId}/files`, o as any); }, { expect2xx: true });
  // upload to another seller's drop / mismatched
  await probe("POST /api/drops/:id/files", "other-seller", () => other.http.json("POST", `/api/drops/${draftId}/files`, { form: up("file", png1) }));

  // =============== F. cross-context: wrong principal on protected routes ===============
  for (const [m, p] of [["GET", "/api/admin/me"], ["GET", "/api/admin/sellers/flagged"], ["GET", "/api/admin/transactions/review"], ["POST", "/api/admin/logout"], ["POST", `/api/admin/sellers/${flagged.id}/clear-flag`], ["GET", "/api/earnings"], ["GET", "/api/drops"], ["GET", "/api/auth/me"], ["GET", "/api/settings"]] as any[]) {
    for (const [who, h] of [["anon", anon()], ["seller", seller.http], ["other-seller", other.http]] as [string, Http][]) {
      if (p.startsWith("/api/admin") && who === "anon") { }
      await probe(`xctx ${m} ${p}`, who, () => h.json(m, p, m === "POST" ? { json: { note: "should not work" } } : {}), { expect2xx: true });
    }
  }
  // query-string junk on every GET api route
  for (const p of ["/api/settings", "/api/earnings", "/api/drops", "/api/auth/me", "/api/admin/me", "/api/admin/sellers/flagged", "/api/admin/transactions/review"]) for (const q of ["?a=%00", "?" + "a=b&".repeat(5000), "?%ff=%fe", "?__proto__[x]=1", "?id[]=1&id[]=2"]) await probe(`query GET ${p}`, q.slice(0, 30), () => (p.startsWith("/api/admin") ? admin : seller.http).json("GET", p + q), { expect2xx: true });

  // =============== G. raw socket abuse (malformed HTTP) ===============
  const rawReq = (s: Buffer | string, wait = 800) => new Promise<{ status: number; text: string }>((res) => { const sock = net.connect(3917, "127.0.0.1"); let buf = ""; const t = setTimeout(() => { sock.destroy(); res({ status: buf ? parseInt(buf.slice(9, 12)) || 0 : 0, text: buf.slice(0, 100) }); }, wait); sock.on("data", (d) => { buf += d.toString("latin1"); }); sock.on("close", () => { clearTimeout(t); res({ status: buf ? parseInt(buf.slice(9, 12)) || 0 : 0, text: buf.slice(0, 100) }); }); sock.on("error", () => {}); sock.write(s); });
  const H = "Host: localhost:3917\r\nConnection: close\r\n";
  const rawCases: [string, string | Buffer][] = [
    ["path %zz", `GET /u/%zz HTTP/1.1\r\n${H}\r\n`], ["path lone %", `GET /api/checkout/status?id=% HTTP/1.1\r\n${H}\r\n`], ["path raw NUL", Buffer.from(`GET /api/drops/\u0000x HTTP/1.1\r\n${H}\r\n`, "latin1")], ["path invalid utf8 %ff", `GET /pay/mock/%ff%fe HTTP/1.1\r\n${H}\r\n`],
    ["url 64KB", `GET /u/${"a".repeat(65000)} HTTP/1.1\r\n${H}\r\n`], ["header 100KB", `GET /api/settings HTTP/1.1\r\n${H}X-A: ${"a".repeat(100000)}\r\n\r\n`], ["method FOO", `FOO /api/settings HTTP/1.1\r\n${H}\r\n`], ["no host (1.1)", `GET /api/settings HTTP/1.1\r\nConnection: close\r\n\r\n`],
    ["dup host", `GET /api/settings HTTP/1.1\r\nHost: a\r\nHost: b\r\nConnection: close\r\n\r\n`], ["absolute-form", `GET http://evil.test/api/settings HTTP/1.1\r\n${H}\r\n`], ["bad chunk", `POST /api/checkout HTTP/1.1\r\n${H}Transfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\nZZ\r\nabc\r\n0\r\n\r\n`],
    ["CL+TE", `POST /api/checkout HTTP/1.1\r\n${H}Content-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`], ["CL negative", `POST /api/checkout HTTP/1.1\r\n${H}Content-Length: -1\r\n\r\n`], ["CL huge no body", `POST /api/checkout HTTP/1.1\r\n${H}Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{`],
    ["host with NUL-ish", `GET /api/settings HTTP/1.1\r\nHost: localhost:3917%00\r\nConnection: close\r\n\r\n`], ["origin header junk", `POST /api/auth/logout HTTP/1.1\r\n${H}Origin: \x01\x02\r\nContent-Length: 0\r\n\r\n`], ["cookie invalid bytes", Buffer.from(`GET /api/auth/me HTTP/1.1\r\n${H}Cookie: unveil_session=\xff\xfe\r\n\r\n`, "latin1")],
    ["accept-encoding junk", `GET /api/settings HTTP/1.1\r\n${H}Accept-Encoding: ${"gzip,".repeat(5000)}\r\n\r\n`], ["HTTP/0.9", `GET /api/settings\r\n\r\n`], ["trace", `TRACE /api/settings HTTP/1.1\r\n${H}\r\n`], ["connect", `CONNECT localhost:3917 HTTP/1.1\r\n${H}\r\n`],
  ];
  for (const [n, s] of rawCases) await probe("RAW socket", n, async () => { const r = await rawReq(s); return { status: r.status === 0 ? 0 : r.status, text: r.text }; }, { expect2xx: true });
  // status 0 (connection dropped w/o response) is acceptable (node http rejects) - but count is reported
  const alive = await fetch(BASE + "/api/settings").then((r) => r.status).catch(() => -1);

  // =============== report ===============
  const raw0 = results.length; const serverAlive = alive === 200;
  const out = { total, serverAliveAfter: serverAlive, fiveXX: fives, stateChangeOn4xx: stateChanges, twoxx: twoxx, unexpected2xxCount: unexpected2xx.length, unexpected2xx: unexpected2xx.slice(0, 400), histogram: histo };
  fs.writeFileSync(`${ART}/pay5-fuzz-results.json`, JSON.stringify(out, null, 1));
  console.log(`requests: ${total}; server alive after: ${serverAlive}; 5xx/errors: ${fives.length}; state change on 4xx: ${stateChanges.length}; 2xx on payloads not expected valid: ${unexpected2xx.length}`);
  for (const f of fives) console.log("5XX", f.route, "|", f.payload, "|", f.status, f.note ?? "");
  for (const f of stateChanges) console.log("STATE-CHANGE-ON-4xx", f.route, "|", f.payload, "|", f.status);
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
