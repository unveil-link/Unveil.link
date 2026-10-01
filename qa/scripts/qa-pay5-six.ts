// @ts-nocheck
/* eslint-disable */
// Round 4 QA, NEW-2: the original NUL repro + the six other 500s the developer says were fixed, each re-run with the original payload, plus lone surrogates / siblings.
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { spawnSync } from "node:child_process";
import { Http, check, assert, eq, db, makeSeller, makeDrop, checkout, stamp, save, done } from "./qa-pay5-lib";
const PW = "Qa-Admin-Passphrase-93!x"; const D36 = "-".repeat(36); const NUL = "a\u0000b";
(async () => {
  const s = await makeSeller("six"); const d = await makeDrop(s, 2000); const fileId = (await db.query("SELECT id FROM drop_files WHERE drop_id=$1", [d.id])).rows[0].id;
  const email = `adm-six-${stamp}@example.test`; spawnSync("npx", ["tsx", "scripts/create-admin.ts", email], { env: { ...process.env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" });
  const A = new Http(); eq((await A.json("POST", "/api/admin/login", { json: { email, password: PW } })).status, 200, "admin login");
  const flagged = await makeSeller("sixflag"); await db.query("UPDATE sellers SET risk_flagged_at=now() WHERE id=$1", [flagged.id]);
  const snap = async () => JSON.stringify((await db.query("SELECT (SELECT count(*) FROM sellers) s,(SELECT count(*) FROM transactions) t,(SELECT count(*) FROM audit_log WHERE action<>'admin_login_failed') a,(SELECT count(*) FROM sellers WHERE risk_flagged_at IS NOT NULL) f")).rows[0]);
  const t = async (id: string, name: string, fn: () => Promise<{ status: number; text?: string }>, want: number[]) => check(id, name, async () => { const b = await snap(); const r = await fn(); assert(want.includes(r.status), `${r.status} ${String(r.text).slice(0, 100)}`); eq(await snap(), b, "state changed"); return `HTTP ${r.status} ${String(r.text).slice(0, 90)} (no state change)`; });
  await t("NEW2-0", "ORIGINAL: NUL byte in clear-flag note (was 500 'invalid byte sequence 0x00') -> 400 invalid_input, flag untouched, 0 audit rows", () => A.json("POST", `/api/admin/sellers/${flagged.id}/clear-flag`, { json: { note: "abc\u0000def" } }), [400]);
  await t("NEW2-0b", "clear-flag note: lone surrogate / 501-char / 1-char / whitespace-only / array / object / null / number -> all 400", async () => { const out = []; for (const note of ["abc\ud800def", "a".repeat(501), "a", "   ", ["x"], { a: 1 }, null, 123, true]) { const r = await A.json("POST", `/api/admin/sellers/${flagged.id}/clear-flag`, { json: { note } }); assert(r.status === 400, `${JSON.stringify(note).slice(0, 20)} -> ${r.status}`); out.push(r.status); } return { status: 400, text: `9 variants -> ${out.join("/")}` }; }, [400]);
  await t("NEW2-1", "[1/6] 36-dash id on POST /api/admin/sellers/:id/clear-flag (was 500) ", () => A.json("POST", `/api/admin/sellers/${D36}/clear-flag`, { json: { note: "valid note" } }), [404]);
  await t("NEW2-2", "[2/6] 36-dash id on /admin/sellers/:id/transactions page (was 500)", () => A.json("GET", `/admin/sellers/${D36}/transactions`), [404]);
  await t("NEW2-3", "[3/6] 36-dash id on GET /api/checkout/status?id= (was 500)", () => new Http().json("GET", `/api/checkout/status?id=${D36}`), [404]);
  await t("NEW2-4", "[4/6] 36-dash id on GET /api/files/:id/preview (was 500)", () => new Http().json("GET", `/api/files/${D36}/preview`), [404]);
  await t("NEW2-5", "[5/6] NUL in /api/dev/payments/pay sessionId (was 500) and in card", () => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: NUL, card: "4242424242424242" } }), [400, 404]);
  await t("NEW2-6", "[6/6] NUL in signup displayName (was 500)", () => new Http().json("POST", "/api/auth/signup", { json: { email: `nul-${stamp}@example.test`, password: "Qa-Pay-Passw0rd!x", displayName: "Na\u0000me" } }), [400]);
  await check("NEW2-7", "siblings of the six: every uuid-consuming path with 36 dashes / other uuid-lookalikes -> 404 (never 500)", async () => {
    const bad = [D36, "00000000-0000-0000-0000-00000000000g", "0".repeat(32), "-".repeat(35), "-".repeat(37), "{00000000-0000-0000-0000-000000000000}", "00000000-0000-0000-0000-000000000000 ", "00000000_0000_0000_0000_000000000000", "００００００００-0000-0000-0000-000000000000"]; const out: string[] = [];
    for (const id of bad) for (const [h, m, p] of [[s.http, "GET", "/api/drops/ID"], [s.http, "POST", "/api/drops/ID/publish"], [s.http, "POST", "/api/drops/ID/unpublish"], [s.http, "POST", "/api/drops/ID/files"], [s.http, "POST", "/api/files/ID/signed-url"], [new Http(), "GET", "/api/files/ID/preview"], [new Http(), "GET", "/api/files/ID/original?exp=9999999999&sig=x"], [new Http(), "GET", "/api/checkout/status?id=ID"], [A, "POST", "/api/admin/sellers/ID/clear-flag"], [A, "GET", "/admin/sellers/ID/transactions"], [s.http, "GET", "/dashboard/drops/ID"], [new Http(), "POST", "/api/dev/payments/refund"]]) {
      const url = p.replace("ID", encodeURIComponent(id)); const init = m === "POST" ? (p.includes("refund") ? { json: { transactionId: id } } : p.includes("clear-flag") ? { json: { note: "valid note" } } : p.includes("publish") ? { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } } } : { json: {} }) : {}; const r = await h.json(m, url, init as any); assert(r.status < 500, `${m} ${url} -> ${r.status}`); out.push(r.status);
    }
    const c: Record<number, number> = {}; out.forEach((x) => (c[x] = (c[x] ?? 0) + 1)); const checkoutLinkBad = await checkout(d.link, { dropId: D36, linkId: undefined }); assert(checkoutLinkBad.status < 500, "checkout dropId 36 dashes " + checkoutLinkBad.status); const co2 = await new Http().json("POST", "/api/checkout", { json: { dropId: D36, email: "a@b.co", confirmOver18: true } }); assert(co2.status < 500, "checkout dropId=36dash " + co2.status);
    return `${out.length} requests, status histogram ${JSON.stringify(c)}; POST /api/checkout dropId=36 dashes -> ${co2.status}`;
  });
  save("pay5-six-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
