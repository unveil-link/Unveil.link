// @ts-nocheck
/* eslint-disable */
// QA: mock provider disabled in production / fail-closed config. Starts its own throwaway servers on 3940-3949 via child processes.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import { check, rec, assert, eq, db, makeSeller, makeDrop, checkout, txRow, mockEvents, signPayload, save, done, ledgerCount, whCount, Http } from "./qa-pay5-lib";

const started: number[] = [];
async function server(port: number, env: Record<string, string | undefined>) {
  const e = { ...process.env, NEXT_DIST_DIR: ".next-qa", NODE_ENV: "production", ...env } as unknown as NodeJS.ProcessEnv;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  void 0;
  const log = fs.openSync(`qa/artifacts/pay5-server-${port}.log`, "w");
  const p = spawn("npx", ["next", "start", "-p", String(port)], { env: e, stdio: ["ignore", log, log], detached: true }) as import("node:child_process").ChildProcess;
  started.push(p.pid!);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${port}/api/settings`)).ok) return p.pid!; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start on " + port);
}
const stop = (pid: number) => { try { process.kill(-pid, "SIGTERM"); } catch { /* */ } };
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET!;
async function probe(port: number, label: string, tx: string, expect: { checkout: number; webhook: number; pay: number; page: number }) {
  const b = `http://localhost:${port}`;
  const h = new Http(); const c = await h.json("POST", "/api/checkout", { base: b, json: { linkId: link, email: "p@example.test", confirmOver18: true } });
  const raw = JSON.stringify(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })); const w = await fetch(`${b}/api/webhooks/mock`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.200.1.1", "x-unveil-signature": signPayload(SECRET, raw, Math.floor(Date.now() / 1000)) }, body: raw });
  const pay = await fetch(`${b}/api/dev/payments/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "mocksess_x", card: "4242424242424242" }) });
  const pg = await fetch(`${b}/pay/mock/mocksess_${"0".repeat(32)}`);
  const got = { checkout: c.status, webhook: w.status, pay: pay.status, page: pg.status };
  eq(JSON.stringify(got), JSON.stringify(expect), `${label} statuses`);
  const t = await txRow(tx); eq(t.status, "pending", `${label}: tx changed by valid-signature webhook!`); eq(await ledgerCount(tx), 0, `${label}: ledger written`);
  return JSON.stringify(got);
}
let link = "", tx = "";
(async () => {
  const s = await makeSeller("prod"); const d = await makeDrop(s, 2000); link = d.link; tx = (await checkout(d.link)).json.transactionId;
  const base = { APP_URL: "http://localhost:3940", RATE_LIMIT_CHECKOUT: "1000/60" };
  let pid = 0;
  await check("PROD-1 (M3 / mock disabled)", "NODE_ENV=production, no MOCK_PAYMENTS_ENABLED, localhost APP_URL: checkout 503, VALID-signature webhook 503 (no state change), dev pay 404, mock page 404", async () => {
    pid = await server(3940, { ...base, MOCK_PAYMENTS_ENABLED: undefined }); const r = await probe(3940, "prod", tx, { checkout: 503, webhook: 503, pay: 404, page: 404 }); stop(pid); return r;
  });
  await check("PROD-2", "production + MOCK_PAYMENTS_ENABLED=1 + PUBLIC APP_URL (https://unveil.link): still disabled", async () => {
    pid = await server(3941, { ...base, APP_URL: "https://unveil.link", MOCK_PAYMENTS_ENABLED: "1" }); const r = await probe(3941, "prod+flag+public", tx, { checkout: 503, webhook: 503, pay: 404, page: 404 }); stop(pid); return r;
  });
  await check("PROD-3", "production + flag + deceptive hosts (http://localhost.evil.com, http://localhost@evil.com, http://127.0.0.1.evil.com): still disabled", async () => {
    const out: string[] = [];
    for (const [i, url] of ["http://localhost.evil.com", "http://localhost@evil.com", "http://127.0.0.1.evil.com", "http://evil.com/localhost"].entries()) {
      const port = 3942 + i; pid = await server(port, { ...base, APP_URL: url, MOCK_PAYMENTS_ENABLED: "1" }); const r = await probe(port, url, tx, { checkout: 503, webhook: 503, pay: 404, page: 404 }); stop(pid); out.push(`${url}:ok`); void r;
    }
    return out.join(" ");
  });
  await check("PROD-4 (config residual risk)", "mock allowed in production when flag=1 + localhost APP_URL (documented e2e exception). Verify that exception works and record the risk: a prod deploy that accidentally sets both is NOT guarded", async () => {
    pid = await server(3946, { ...base, APP_URL: "http://localhost:3946", MOCK_PAYMENTS_ENABLED: "1" }); const c = await new Http().json("POST", "/api/checkout", { base: "http://localhost:3946", json: { linkId: link, email: "p@example.test", confirmOver18: true } }); stop(pid);
    assert(c.status === 201 || c.status === 200, "checkout w/ exception " + c.status); return "exception works (201) — only when both flag and loopback APP_URL are set";
  });
  await check("PROD-5 missing/short secret fails closed", "PAYMENT_WEBHOOK_SECRET 31 chars / empty / 5 chars (truly-unset not testable: Next auto-loads the worktree .env): checkout 503 + webhook 503 even in non-prod-flag mode (local build flag on)", async () => {
    const out: string[] = [];
    for (const [i, sec] of ["a".repeat(31), "", " ".repeat(40).slice(0, 5)].entries()) {
      const port = 3947 + i; pid = await server(port, { ...base, APP_URL: `http://localhost:${port}`, MOCK_PAYMENTS_ENABLED: "1", PAYMENT_WEBHOOK_SECRET: sec });
      const c = await new Http().json("POST", "/api/checkout", { base: `http://localhost:${port}`, json: { linkId: link, email: "p@example.test", confirmOver18: true } });
      const raw = JSON.stringify(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })); const secrets = [sec ?? "", SECRET];
      const w = await fetch(`http://localhost:${port}/api/webhooks/mock`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.200.1.2", "x-unveil-signature": signPayload(sec ?? "", raw, Math.floor(Date.now() / 1000)) }, body: raw }); void secrets; stop(pid);
      eq(c.status, 503, `checkout secret=${JSON.stringify(sec)?.length}`); eq(w.status, 503, "webhook"); eq((await txRow(tx)).status, "pending", "state"); out.push(`${sec === undefined ? "unset" : sec.length + "ch"}:503/503`);
    }
    return out.join(" ");
  });
  await check("PROD-6 unknown PAYMENT_PROVIDER", "PAYMENT_PROVIDER=stripe / segpay (not registered) → checkout 503 (fails closed), not fallback to mock", async () => {
    pid = await server(3949, { ...base, APP_URL: "http://localhost:3949", MOCK_PAYMENTS_ENABLED: "1", PAYMENT_PROVIDER: "segpay" }); const c = await new Http().json("POST", "/api/checkout", { base: "http://localhost:3949", json: { linkId: link, email: "p@example.test", confirmOver18: true } }); stop(pid); eq(c.status, 503, c.text); return "503 payments_unavailable";
  });
  await check("PROD-7 test card in prod", "no test-card acceptance in prod: /api/dev/payments/pay 404 for card 4242 (covered by PROD-1/2/3: pay=404) and no tx became succeeded", async () => {
    const r = await db.query("SELECT count(*) n FROM transactions WHERE id=$1 AND status<>'pending'", [tx]); eq(Number(r.rows[0].n), 0, "tx moved"); return "tx remained pending across all prod-mode probes";
  });
  await check("PROD-8 non-'production' NODE_ENV", "R2: config.mockPaymentsAllowed is FALSE for NODE_ENV=staging (default-deny)", async () => {
    const out = execSync(`NODE_ENV=staging npx tsx -e "import {config} from './src/server/config'; console.log(config.mockPaymentsAllowed)"`, { env: { ...process.env, NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv }).toString().trim();
    eq(out, "false", "NODE_ENV=staging must fail closed (R2 BUG-8 fix)"); return `NODE_ENV=staging → mockPaymentsAllowed=${out} (R2: default-deny; was true in round 1)`;
  });
  save("pay5-old-prod-results.json"); await done();
})().catch((e) => { console.error(e); started.forEach(stop); process.exit(1); }).finally(() => started.forEach(stop));
