// FE-17 / FE-19 claim-by-claim behaviour checks. env BASE (limits-off, mock on), BASE_LIM (default limits), SEED, DB, OUT, WT
import * as L from "./qa-fe6-lib.mjs"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
const { log, ok, usd, BASE, seed } = L; const db = await L.dbc(); const b = await L.browser();
const H = (ip) => ({ "content-type": "application/json", origin: BASE, "x-forwarded-for": ip ?? L.fakeIp(61) });
const api = async (path, body, ip) => { const r = await fetch(BASE + path, { method: "POST", headers: H(ip), body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null) }; };
const text = async (url, vp = { width: 1280, height: 900 }, ctxOpts = {}) => { const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(62) }, ...ctxOpts }); const p = await c.newPage(); await p.goto(BASE + url, { waitUntil: "networkidle" }); const t = await p.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("details")].map((d) => d.textContent).join(" ")); const html = await p.content(); await c.close(); return { t, html }; };
const S = (await db.query("select * from platform_settings where id=1")).rows[0];

log("== A. FAQ 'How do I get paid?' vs behaviour");
ok(S.payout_hold_days === 7 && S.min_payout_cents === 2500, `platform_settings: payout_hold_days=${S.payout_hold_days}, min_payout_cents=${S.min_payout_cents} (copy: 7-day hold, $25)`);
{ const { t } = await text("/"); ok(/Each sale is listed in your dashboard as Pending\. After a 7-day hold it becomes Available, and payouts start at \$25\. Payout requests and processing are coming soon\./.test(t), "landing FAQ states Pending -> 7-day hold -> Available -> $25 minimum -> payout requests coming soon");
  ok(!/straight to your bank/i.test(t) && !/payments? partner/i.test(t), "no 'straight to your bank' / 'payments partner' on landing"); }
// seller + sale: Pending immediately, Available only after hold; fees at sale time
const email = `qa-claims-${crypto.randomBytes(3).toString("hex")}@example.com`; await api("/api/auth/signup", { email, password: L.PW, displayName: "Claims Tester" });
const row0 = (await db.query("select id, verification_status from sellers where email=$1", [email])).rows[0]; const sid = row0.id;
ok(row0.verification_status === "pending", "new signup starts as verification_status=pending (nobody/nothing verifies automatically)");
await db.query("update sellers set verification_status='verified' where id=$1", [sid]);
const mk = async (cents, status = "published") => { const link = crypto.randomBytes(9).toString("base64url"); await db.query("insert into drops (seller_id,title,description,price_cents,status,public_link_id) values ($1,'Claim drop','d',$2,$3,$4)", [sid, cents, status, link]); return link; };
const buy = async (link) => { const c = await api("/api/checkout", { linkId: link, email: `c${crypto.randomBytes(3).toString("hex")}@example.test`, confirmOver18: true }); const p = await api("/api/dev/payments/pay", { sessionId: c.j.checkoutUrl.split("/").pop(), card: "4242424242424242" }); return { c, p, tx: c.j.transactionId ?? p.j?.transactionId }; };
const lg = await api("/api/auth/login", { email, password: L.PW }); const lr = await fetch(BASE + "/api/auth/login", { method: "POST", headers: H(), body: JSON.stringify({ email, password: L.PW }) }); const ck = lr.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
const earn = async () => (await fetch(BASE + "/api/earnings", { headers: { cookie: ck } })).json();
const link = await mk(2000); const t0 = new Date(); const sale = await buy(link); ok(sale.p.s === 200 && sale.p.j.status === "succeeded", "sale succeeded");
let e = await earn(); ok(e.balance.pendingCents === 1560 && e.balance.availableCents === 0, `immediately after the sale: Pending ${usd(e.balance.pendingCents)} (=$20 - 10% platform - 12% processing = $15.60), Available ${usd(e.balance.availableCents)}`);
const led = (await db.query("select le.entry_type, le.amount_cents, le.created_at, le.available_at, t.created_at tx_at from ledger_entries le join transactions t on t.id=le.transaction_id where le.seller_id=$1 order by le.id", [sid])).rows;
log("   ledger @ sale: " + led.map((x) => `${x.entry_type} ${x.amount_cents}`).join(", "));
ok(led.some((x) => x.entry_type === "platform_fee") && led.some((x) => x.entry_type === "processing_fee") && led.some((x) => x.entry_type === "sale_credit"), "platform_fee + processing_fee + sale_credit are all posted AT SALE TIME (fees are not deferred to payout)");
const holdMs = led.map((x) => new Date(x.available_at) - new Date(x.tx_at)); ok(holdMs.every((m) => Math.abs(m - 7 * 86400e3) < 120e3), `available_at = sale time + 7 days for every line (${holdMs.map((m) => (m / 86400e3).toFixed(4)).join(", ")} d)`);
{ const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c.addCookies(ck.split("; ").map((kv) => ({ name: kv.split("=")[0], value: kv.slice(kv.indexOf("=") + 1), url: BASE }))); const p = await c.newPage(); await p.goto(BASE + "/dashboard", { waitUntil: "networkidle" }); const t = await p.evaluate(() => document.body.innerText); await c.close();
  ok(/Pending\s*\n?\$15\.60\s*\n?Becomes available 7 days after each sale/.test(t), "dashboard shows Pending $15.60 'Becomes available 7 days after each sale'"); ok(/Available\s*\n?\$0\.00\s*\n?Nothing to pay out yet/.test(t), "dashboard Available $0.00 'Nothing to pay out yet' (below $25 minimum)"); }
// payout paths do not exist -> 'coming soon' is accurate
for (const p of ["/api/payouts", "/api/payouts/request", "/api/earnings/payout", "/dashboard/payouts"]) { const g = await fetch(BASE + p, { headers: { cookie: ck } }); const po = await fetch(BASE + p, { method: "POST", headers: { ...H(), cookie: ck }, body: "{}" }); ok(g.status === 404 && po.status === 404, `${p}: GET ${g.status} POST ${po.status} (no seller payout request path -> 'coming soon' is accurate)`); }
// reach $25 -> hint text
await db.query("update platform_settings set payout_hold_days=0 where id=1"); await buy(await mk(4000)); await db.query("update platform_settings set payout_hold_days=$1 where id=1", [S.payout_hold_days]); e = await earn(); // ledger is append-only: a zero-hold sale stands in for 'hold has passed'
ok(e.payoutEligible === true && e.balance.availableCents >= 2500, `after hold passes and balance >= $25: payoutEligible=${e.payoutEligible}, available=${usd(e.balance.availableCents)}`);
{ const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c.addCookies(ck.split("; ").map((kv) => ({ name: kv.split("=")[0], value: kv.slice(kv.indexOf("=") + 1), url: BASE }))); const p = await c.newPage(); await p.goto(BASE + "/dashboard", { waitUntil: "networkidle" }); const t = await p.evaluate(() => document.body.innerText); await c.close();
  ok(/You’ve reached the \$25\.00 minimum\. Payout requests are coming soon/.test(t), "dashboard hint: 'You've reached the $25.00 minimum. Payout requests are coming soon'"); ok(!/Ready for a payout/.test(t), "old 'Ready for a payout' hint gone"); ok(/No payouts yet/.test(t), "Paid out hint 'No payouts yet' (nothing paid)"); }
log("   paid-out hint wording ('Payouts marked as paid'): payouts are record-only (see payout-ui log) - the wording does not claim money moved");

log("== B. Settings drift: landing copy is static (lib/features.ts), dashboard is live");
await db.query("update platform_settings set payout_hold_days=3, min_payout_cents=5000 where id=1");
{ const { t } = await text("/"); const stale = /After a 7-day hold/.test(t) && /payouts start at \$25\./.test(t); log(`   INFO: with hold=3 / min=$50 in platform_settings the landing FAQ still says 7-day / $25: ${stale ? "STALE (static copy)" : "follows settings"}`); }
{ const e2 = await earn(); log(`   /api/earnings follows settings: holdDays=${e2.holdDays} minPayoutCents=${e2.minPayoutCents}`); }
await db.query("update platform_settings set payout_hold_days=$1, min_payout_cents=$2 where id=1", [S.payout_hold_days, S.min_payout_cents]);

log("== C. Video claim vs upload reality (main 7014c7e has no video upload; backend/m2-media not merged)");
{ const d = await mk(500, "draft"); const dr = (await db.query("select id from drops where public_link_id=$1", [d])).rows[0].id;
  const fd = new FormData(); fd.append("file", new Blob([Buffer.from("00000018667479706d703432000000006d70343269736f6d00000008667265" + "65", "hex")], { type: "video/mp4" }), "t.mp4");
  const r = await fetch(`${BASE}/api/drops/${dr}/files`, { method: "POST", headers: { cookie: ck, origin: BASE, "x-forwarded-for": L.fakeIp(63) }, body: fd }); ok(r.status === 415, `POST video/mp4 -> ${r.status} ${(await r.text()).slice(0, 80)} (415 = not accepted)`);
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c.addCookies(ck.split("; ").map((kv) => ({ name: kv.split("=")[0], value: kv.slice(kv.indexOf("=") + 1), url: BASE }))); const p = await c.newPage();
  for (const u of ["/dashboard/drops/new", `/dashboard/drops/${dr}`]) { await p.goto(BASE + u, { waitUntil: "networkidle" }); const t = await p.evaluate(() => document.body.innerText); const acc = await p.evaluate(() => [...document.querySelectorAll("input[type=file]")].map((i) => i.accept));
    ok(!/\bMP4\b/.test(t.replace(/MP4 video[^.]*is coming soon\.|MP4 video uploads are coming soon[^.]*\./g, "")), `${u}: no unqualified 'MP4' in the visible text`);
    ok(!acc.some((a) => /mp4/i.test(a)), `${u}: file picker accept="${acc.join("|")}" does not offer MP4`); }
  await c.close();
  const { t: lt } = await text("/"); ok(!/\bvideos?\b/i.test(lt.replace(/video is coming soon/g, "")), "landing: no live 'video(s)' claim (only 'video is coming soon')"); }

log("== D. Verification claims: publish gate, buyer badge only while verified, checkout refused when not verified");
{ const maya = seed.maya.email; const spring = seed.maya.links.spring; const mid = (await db.query("select id from sellers where email=$1", [maya])).rows[0].id;
  for (const st of ["verified", "pending", "failed", "manual_review"]) { await db.query("update sellers set verification_status=$1 where id=$2", [st, mid]); const { html } = await text(`/u/${spring}`); const badge = /Verified creator/.test(html);
    const c = await api("/api/checkout", { linkId: spring, email: "v@example.test", confirmOver18: true });
    ok(badge === (st === "verified"), `seller ${st}: buyer-page 'Verified creator' badge ${badge ? "shown" : "hidden"}; page ${(await fetch(BASE + "/u/" + spring)).status}; checkout -> ${c.s} ${c.j?.code ?? c.j?.error ?? ""}`); }
  await db.query("update sellers set verification_status='verified' where id=$1", [mid]); }
{ const jp = seed.jo; const lj = await fetch(BASE + "/api/auth/login", { method: "POST", headers: H(), body: JSON.stringify({ email: jp.email, password: L.PW }) }); const jc = lj.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const r = await fetch(`${BASE}/api/drops/${jp.dropId}/publish`, { method: "POST", headers: { ...H(), cookie: jc }, body: JSON.stringify({ attestation: { over18: true, ownsRights: true, consentOfSubjects: true } }) }); log(`   pending seller publish -> ${r.status} ${(await r.text()).slice(0, 160)}`); ok(r.status === 403, "pending seller cannot publish (403)");
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c.addCookies(jc.split("; ").map((kv) => ({ name: kv.split("=")[0], value: kv.slice(kv.indexOf("=") + 1), url: BASE }))); const p = await c.newPage();
  await p.goto(BASE + "/dashboard/drops", { waitUntil: "networkidle" }); const pb = p.getByRole("button", { name: /^publish$/i }).first(); if (await pb.count()) { await pb.click(); await p.waitForTimeout(1000); const t = await p.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[role=dialog],[role=alertdialog],dialog")].map((d) => d.textContent).join(" ")); await p.screenshot({ path: `${L.OUT}/fe6-pending-publish-dialog.png` }); const m = t.match(/Verification needed[\s\S]{0,200}/); log("   UI Publish dialog for a pending seller: " + (m ? m[0].replace(/\s+/g, " ").trim() : "(no verification message found)")); ok(/can.t publish until you.re verified/.test(t), "Publish dialog explains verification is needed (button disabled: " + (await p.getByRole("button", { name: /^publish$/i }).last().isDisabled()) + ")"); ok(!/Identity verification required/.test(t), "UI does not show the backend string 'Identity verification required to publish'"); } else log("   (no Publish button on /dashboard/drops for Jo)");
  await c.close(); }

log("== E. Card numbers are not stored (buy with 4242 4242 4242 4242 through the UI, then search DB dump, storage, mail dir, server logs)");
{ const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(64) } }); const p = await c.newPage(); await p.goto(BASE + `/u/${seed.maya.links.spring}`, { waitUntil: "networkidle" }); await p.fill("#buyer-email", `card+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check();
  await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]); await p.fill("input[name=card], input[autocomplete=cc-number], #card", "4242424242424242"); await p.locator("button[type=submit]").first().click(); await p.waitForTimeout(2500); await c.close(); }
{ const dump = execSync(`sudo -n -u postgres pg_dump ${new URL(process.env.DB).pathname.slice(1)} | cat`, { maxBuffer: 1 << 28 }).toString(); const hit = /4242[ -]?4242[ -]?4242[ -]?4242/.test(dump); ok(!hit, `DB dump (${(dump.length / 1e6).toFixed(1)} MB): card number not present`);
  const g = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const grep = g(`grep -rIl "4242[ -]\\?4242[ -]\\?4242[ -]\\?4242" ${process.env.WT}/.qa-storage ${process.env.MAIL_DIR} ${process.env.WT}/server-4601.log 2>/dev/null`); ok(grep === "", `storage dir, mail dir and server log: card number not present ${grep ? "(" + grep + ")" : ""}`); }
log("   NOTE: the mock hosted page POSTs the card number to Unveil's OWN /api/dev/payments/pay (mock processor, disabled in production) - 'separate checkout page' is true, 'separate PROVIDER' is not claimed.");

log("== F. FE-19: payment link entropy / listing / enumeration");
{ const ids = (await db.query("select public_link_id id from drops")).rows.map((r) => r.id); const uniq = new Set(ids).size;
  ok(ids.every((i) => /^[A-Za-z0-9_-]{12}$/.test(i)), `${ids.length} link ids: all 12 chars of [A-Za-z0-9_-] (base64url of 9 random bytes = 72 bits)`); ok(uniq === ids.length, "all link ids unique");
  const gen = Array.from({ length: 4000 }, () => crypto.randomBytes(9).toString("base64url")); const allIds = ids.concat(gen); const cnt = {}; for (const i of allIds.join("")) cnt[i] = (cnt[i] ?? 0) + 1; const n = allIds.join("").length; const exp = n / 64; const chi = Object.values(cnt).reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
  log(`   char distribution of ${ids.length} real ids + 4000 reference ids: chi2=${chi.toFixed(1)} (63 dof, 99.9% < 103)`); log(`   first chars of real ids: ${[...new Set(ids.map((i) => i[0]))].length} distinct over ${ids.length}`); // real ids come from the app's own generator
  const real = ids.filter((i) => i.length === 12); const cr = {}; for (const i of real.join("")) cr[i] = (cr[i] ?? 0) + 1; log(`   real ids: ${real.join("").length} chars, ${Object.keys(cr).length} distinct symbols; 12-char random space = 2^72 = 4.7e21`); }
{ const spring = seed.maya.links.spring; const r = await fetch(BASE + `/u/${spring}`); ok((r.headers.get("x-robots-tag") ?? "").includes("noindex"), `/u/<id> X-Robots-Tag: ${r.headers.get("x-robots-tag")}`);
  const rb = await (await fetch(BASE + "/robots.txt")).text(); ok(/Disallow: \/u\//.test(rb), "robots.txt Disallow: /u/"); log("   (robots.txt is advisory only; unguessability + noindex are the real protections)");
  for (const p of ["/sitemap.xml", "/u", "/u/", "/api/public/drops", "/api/public/drops/", "/api/drops", "/api/public", "/d/x", "/sellers", "/explore", "/search", "/@maya", "/maya"]) { const g = await fetch(BASE + p); ok([401, 404, 405].includes(g.status), `GET ${p} -> ${g.status} (no listing / sitemap / profile exposes links)`); }
  const pg = await text(`/u/${spring}`); const ext = [...pg.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith("https://unveil.link")); ok(ext.length === 0, `buyer page has no external links that could leak the URL via Referer (${ext.join(", ") || "none"}); Referrer-Policy: ${r.headers.get("referrer-policy")}`);
  const api = await (await fetch(BASE + `/api/public/drops/${spring}`)).json(); ok(!JSON.stringify(api).includes(seed.maya.links.studio) && !JSON.stringify(api).includes(seed.maya.links.travel), "public drop API does not reveal the seller's other links");
  ok(!pg.html.includes(seed.maya.links.studio) && !pg.html.includes(seed.maya.links.travel) && !pg.html.includes(seed.maya.links.draft), "buyer page HTML does not contain the seller's other links");
  const unpub = await fetch(BASE + `/u/${seed.maya.links.unpublished}`), unk = await fetch(BASE + "/u/ZZZZZZZZZZZZ"), draft = await fetch(BASE + `/u/${seed.maya.links.draft}`); log(`   unpublished -> ${unpub.status}, draft -> ${draft.status}, unknown -> ${unk.status}`); ok(unpub.status === unk.status && draft.status === unk.status, "unpublished / draft / unknown links give the same status (no existence oracle)");
  const ub = (await unpub.text()).replace(/_next\/static[^"]*|"[A-Za-z0-9_-]{20,}"/g, ""), kb = (await unk.text()).replace(/_next\/static[^"]*|"[A-Za-z0-9_-]{20,}"/g, ""); ok(ub.length === kb.length || Math.abs(ub.length - kb.length) < 40, `unpublished vs unknown page bodies match (len ${ub.length} vs ${kb.length})`); }
{ // enumeration against the default-limits instance
  const LIM = process.env.BASE_LIM; const probe = async (path, ip, n) => { const codes = {}; for (let i = 0; i < n; i++) { const r = await fetch(LIM + path(), { headers: { "x-forwarded-for": ip } }); codes[r.status] = (codes[r.status] ?? 0) + 1; } return codes; };
  const rid = () => crypto.randomBytes(9).toString("base64url");
  const a = await probe(() => "/api/public/drops/" + rid(), "10.99.1.1", 160); log(`   160 random /api/public/drops/<id> probes from one IP (default limits): ${JSON.stringify(a)}`); ok(a[429] > 0, "API enumeration from one IP is rate-limited (PUBLIC_LINK 120/min)");
  const pg = await probe(() => "/u/" + rid(), "10.99.1.2", 160); log(`   160 random /u/<id> PAGE probes from one IP (default limits): ${JSON.stringify(pg)}`); log(`   INFO: the /u/<id> page route has no rate limit (only the JSON API and /api/checkout/status do); guessing is still infeasible (2^72 ids)`); }
await db.end(); await b.close(); L.done();
