/* eslint-disable */
// Shared helpers for payments QA probes. Talks to a running app over HTTP + inspects the throwaway DB directly.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";
import { mockEvents, mockSaleId, signMockEvent } from "../../src/server/payments/mock/events";
import { signPayload } from "../../src/server/payments/signature";

loadEnv({ path: path.resolve(__dirname, "../../.env"), quiet: true });
export const BASE = process.env.QA_BASE_URL ?? "http://localhost:3517";
export const SECRET = process.env.PAYMENT_WEBHOOK_SECRET!;
export const DBURL = process.env.DATABASE_URL!;
if (!/unveil_qa_pay/.test(DBURL)) throw new Error("refusing: DATABASE_URL is not the throwaway qa-pay DB");
export const ART = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(ART, { recursive: true });
export { mockEvents, mockSaleId, signMockEvent, signPayload };

export const db = new Client({ connectionString: DBURL });
export const dbReady = db.connect();

let ipCounter = Math.floor(Math.random() * 200) * 250 + 1000;
export const freshIp = () => { ipCounter++; return `10.${77 + (Math.floor(ipCounter / 62500) % 100)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`; };

export class Http {
  cookies = new Map<string, string>();
  ip = freshIp();
  async req(method: string, url: string, init: { json?: unknown; raw?: string; form?: FormData; headers?: Record<string, string>; base?: string } = {}) {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...(init.headers ?? {}) };
    let body: BodyInit | undefined;
    if (init.json !== undefined) { headers["content-type"] ??= "application/json"; body = JSON.stringify(init.json); }
    else if (init.raw !== undefined) body = init.raw;
    else if (init.form) body = init.form;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url.startsWith("http") ? url : (init.base ?? BASE) + url, { method, headers, body, redirect: "manual" });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";"); const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v === "" || /max-age=0/i.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    return res;
  }
  async json(method: string, url: string, init: Parameters<Http["req"]>[2] = {}) {
    const r = await this.req(method, url, init);
    const text = await r.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json: j, text, headers: r.headers };
  }
}

export const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const png = (rgb: string) => sharp({ create: { width: 48, height: 48, channels: 3, background: rgb } }).png().toBuffer();
const att = { over18: true, ownsRights: true, consentOfSubjects: true };

export interface Seller { http: Http; id: string; email: string }
export async function makeSeller(label: string, verified = true): Promise<Seller> {
  await dbReady;
  const http = new Http(); const email = `${label}+${stamp}@example.test`;
  const r = await http.json("POST", "/api/auth/signup", { json: { email, password: "Qa-Pay-Passw0rd!x", displayName: `QA ${label}` } });
  if (r.status !== 201) throw new Error(`signup ${r.status} ${r.text}`);
  if (verified) await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [email]);
  const id = (await db.query("SELECT id FROM sellers WHERE email=$1", [email])).rows[0].id;
  return { http, id, email };
}
export async function makeDrop(s: Seller, priceCents: number, opts: { publish?: boolean; title?: string } = {}) {
  const d = await s.http.json("POST", "/api/drops", { json: { title: opts.title ?? `QA drop ${priceCents}`, priceCents } });
  if (d.status !== 201) throw new Error(`create drop ${priceCents}: ${d.status} ${d.text}`);
  const drop = d.json.drop;
  const f = new FormData(); f.append("file", new Blob([new Uint8Array(await png("#336699"))], { type: "image/png" }), "t.png");
  const u = await s.http.json("POST", `/api/drops/${drop.id}/files`, { form: f });
  if (u.status !== 201) throw new Error(`upload ${u.status} ${u.text}`);
  if (opts.publish !== false) {
    const p = await s.http.json("POST", `/api/drops/${drop.id}/publish`, { json: { attestation: att } });
    if (p.status !== 200) throw new Error(`publish ${p.status} ${p.text}`);
  }
  return { id: drop.id as string, link: drop.public_link_id as string };
}
export const checkout = (link: string, extra: Record<string, unknown> = {}, http = new Http(), email = `buyer+${stamp}@example.test`) =>
  http.json("POST", "/api/checkout", { json: { linkId: link, email, confirmOver18: true, ...extra } });

export async function sendWebhook(ev: unknown, opts: { secret?: string; nowSec?: number; provider?: string; ip?: string; base?: string; headers?: Record<string, string>; rawBody?: string; sig?: string | null } = {}) {
  const rawBody = opts.rawBody ?? JSON.stringify(ev);
  const t = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? freshIp(), ...(opts.headers ?? {}) };
  if (opts.sig !== null) headers["x-unveil-signature"] = opts.sig ?? signPayload(opts.secret ?? SECRET, rawBody, t);
  const r = await fetch(`${opts.base ?? BASE}/api/webhooks/${opts.provider ?? "mock"}`, { method: "POST", headers, body: rawBody });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text };
}

export const ledgerSum = async (txId: string) => Number((await db.query("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE transaction_id=$1", [txId])).rows[0].s);
export const ledgerCount = async (txId: string) => Number((await db.query("SELECT count(*) n FROM ledger_entries WHERE transaction_id=$1", [txId])).rows[0].n);
export const txRow = async (id: string) => (await db.query("SELECT * FROM transactions WHERE id=$1", [id])).rows[0];
export const sellerLedgerSum = async (sid: string) => Number((await db.query("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE seller_id=$1", [sid])).rows[0].s);
export const whCount = async () => Number((await db.query("SELECT count(*) n FROM webhook_events")).rows[0].n);

/** Pay a pending transaction through the real signed-webhook path. */
export const paySale = (txId: string, amountCents: number, o: { eventId?: string; saleId?: string } = {}) =>
  sendWebhook(mockEvents.saleSucceeded({ transactionId: txId, amountCents, eventId: o.eventId, saleId: o.saleId }));
/** checkout + paid sale for a drop; returns tx id. */
export async function sell(link: string, amountCents: number, email?: string) {
  const c = await checkout(link, {}, new Http(), email);
  if (c.status !== 201) throw new Error(`checkout ${c.status} ${c.text}`);
  const txId = c.json.transactionId as string;
  const w = await paySale(txId, amountCents);
  if (w.status !== 200 || w.json?.outcome !== "processed") throw new Error(`sale webhook ${w.status} ${w.text}`);
  return txId;
}
export const refundEv = (txId: string, amountCents: number | null, refundId = `rf_${crypto.randomBytes(6).toString("hex")}`, eventId?: string) =>
  mockEvents.refund({ transactionId: txId, refundId, amountCents, eventId });
export const cbEv = (txId: string, amountCents: number | null, n = 1, eventId?: string) =>
  mockEvents.chargeback({ transactionId: txId, amountCents, chargebackId: `cb_${txId.slice(0, 8)}_${n}_${crypto.randomBytes(3).toString("hex")}`, eventId });

// ---- result recording ----
export type Res = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN" | "NOTE";
export interface Rec { id: string; name: string; result: Res; evidence: string }
const recs: Rec[] = [];
export function rec(id: string, name: string, result: Res, evidence: string) {
  recs.push({ id, name, result, evidence });
  console.log(`${result.padEnd(7)} ${id.padEnd(12)} ${name} — ${evidence.slice(0, 300)}`);
}
/** Run fn; PASS when it returns a string (evidence); FAIL when it throws. */
export async function check(id: string, name: string, fn: () => Promise<string>) {
  try { rec(id, name, "PASS", await fn()); } catch (e) { rec(id, name, "FAIL", (e as Error).message); }
}
export function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
export function eq<T>(a: T, b: T, w: string) { assert(a === b, `${w}: expected ${String(b)}, got ${String(a)}`); }
export function save(file: string) {
  fs.writeFileSync(path.join(ART, file), JSON.stringify(recs, null, 2));
  const c = (r: Res) => recs.filter((x) => x.result === r).length;
  console.log(`\nSaved ${file}: PASS ${c("PASS")} FAIL ${c("FAIL")} BLOCKED ${c("BLOCKED")} NOTE ${c("NOTE")}`);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function setSettings(sql: string) { await db.query(`UPDATE platform_settings SET ${sql} WHERE id=1`); }
export async function done() { await db.end(); }
