// Shared helpers for the backend/m2-media QA probes. env: BASE, DB, STORAGE (local storage dir), MEDIA (fixtures dir), TMPDIR_UP (UPLOAD_TMP_DIR), WEBHOOK_SECRET
import pg from "pg"; import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import sharp from "sharp";
export const BASE = process.env.BASE ?? "http://localhost:3260";
export const STORAGE = process.env.STORAGE ?? "/workspace/qa-m2/storage";
export const MEDIA = process.env.MEDIA ?? "/workspace/qa-m2/media";
export const UPTMP = process.env.TMPDIR_UP ?? "/workspace/qa-m2/tmp";
export const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stamp = crypto.randomBytes(3).toString("hex");
let ipc = Math.floor(Math.random() * 60000);
export const freshIp = () => { ipc++; return `10.${100 + (ipc >> 16 & 63)}.${(ipc >> 8) & 255}.${(ipc & 255) || 1}`; };
export class Http {
  cookies = new Map(); ip = freshIp();
  async req(method, url, { json, raw, form, headers = {}, body } = {}) {
    const h = { "x-forwarded-for": this.ip, ...headers }; let b = body;
    if (json !== undefined) { h["content-type"] ??= "application/json"; b = JSON.stringify(json); } else if (raw !== undefined) b = raw; else if (form) b = form;
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(BASE + url, { method, headers: h, body: b, redirect: "manual" });
    for (const sc of r.headers.getSetCookie()) { const [p] = sc.split(";"); const i = p.indexOf("="); const k = p.slice(0, i), v = p.slice(i + 1); if (v === "" || /max-age=0/i.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v); }
    return r;
  }
  async j(method, url, o = {}) { const r = await this.req(method, url, o); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text, headers: r.headers }; }
}
export async function makeSeller(label, { verified = true } = {}) {
  const http = new Http(); const email = `${label}+${stamp}${Math.random().toString(36).slice(2, 6)}@example.test`;
  const r = await http.j("POST", "/api/auth/signup", { json: { email, password: "Qa-M2-Passw0rd!x", displayName: `QA ${label}` } });
  if (r.status !== 201) throw new Error(`signup ${r.status} ${r.text}`);
  if (verified) await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [email]);
  const id = (await db.query("SELECT id FROM sellers WHERE email=$1", [email])).rows[0].id; return { http, id, email };
}
export const att = { over18: true, ownsRights: true, consentOfSubjects: true };
export async function newDrop(s, o = {}) { const r = await s.http.j("POST", "/api/drops", { json: { title: o.title ?? "QA m2 drop", description: o.description ?? "desc", priceCents: o.priceCents ?? 2000 } }); if (r.status !== 201) throw new Error(`create drop ${r.status} ${r.text}`); return r.json.drop; }
export const png = (rgb = "#336699", w = 64, h = 64) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();
export function fileForm(buf, name, type, field = "file") { const f = new FormData(); f.append(field, new Blob([buf], { type }), name); return f; }
export const upload = (s, dropId, buf, name, type, extra = {}) => s.http.j("POST", `/api/drops/${dropId}/files`, { form: fileForm(buf, name, type), ...extra });
export const media = (n) => fs.readFileSync(path.join(MEDIA, n));
export const dropFiles = async (dropId) => (await db.query("SELECT * FROM drop_files WHERE drop_id=$1 ORDER BY sort_order, id", [dropId])).rows;
export function walk(dir) { const out = []; if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
export const storedFiles = () => walk(STORAGE);
export const tmpFiles = () => (fs.existsSync(UPTMP) ? fs.readdirSync(UPTMP) : []);
// results
export const recs = []; let FAILS = 0;
export function rec(id, name, result, evidence) { recs.push({ id, name, result, evidence }); if (result === "FAIL") FAILS++; console.log(`${result.padEnd(7)} ${id.padEnd(10)} ${name} — ${String(evidence).slice(0, 400)}`); }
export async function check(id, name, fn) { try { rec(id, name, "PASS", await fn()); } catch (e) { rec(id, name, "FAIL", e.message); } }
export function assert(c, m) { if (!c) throw new Error(m); }
export function eq(a, b, w) { assert(a === b, `${w}: expected ${b}, got ${a}`); }
export function save(file) { fs.mkdirSync("qa/artifacts/backend-m2-media", { recursive: true }); fs.writeFileSync(`qa/artifacts/backend-m2-media/${file}`, JSON.stringify(recs, null, 2)); const c = (r) => recs.filter((x) => x.result === r).length; console.log(`\nSaved ${file}: PASS ${c("PASS")} FAIL ${c("FAIL")} NOTE ${c("NOTE")} BLOCKED ${c("BLOCKED")}`); }
export async function done() { await db.end(); }
// ---- payments helpers (mock processor) ----
import { createRequire } from "node:module";
export function signWebhook(secret, raw, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`; }
const h24 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);
export const mockSaleId = (tx) => `mocktx_${h24(tx)}`;
export async function sell(link, amountCents, email = `buyer${Math.random().toString(36).slice(2, 8)}@example.test`) {
  const c = await new Http().j("POST", "/api/checkout", { json: { linkId: link, email, confirmOver18: true } });
  if (c.status !== 201) throw new Error(`checkout ${c.status} ${c.text}`);
  const tx = c.json.transactionId; const ev = { id: `evt_${crypto.randomBytes(8).toString("hex")}`, type: "sale.succeeded", created: new Date().toISOString(), data: { transaction_id: mockSaleId(tx), reference: tx, amount_cents: amountCents, currency: "USD" } };
  const raw = JSON.stringify(ev); const r = await fetch(`${BASE}/api/webhooks/mock`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), "x-unveil-signature": signWebhook(process.env.WEBHOOK_SECRET, raw) }, body: raw });
  return { tx, status: r.status, text: await r.text(), checkout: c };
}
// drop with one image (and optionally a video), optionally published; returns {drop, link, files[]}
export async function mkDrop(s, { publish = true, video = false, images = 1, ...o } = {}) {
  const drop = await newDrop(s, o); const files = [];
  for (let i = 0; i < images; i++) { const r = await upload(s, drop.id, await png("#" + (0x223344 + i * 4097 + Math.floor(Math.random() * 9999)).toString(16).padStart(6, "0").slice(-6), 50 + i), `img${i}.png`, "image/png"); if (r.status !== 201) throw new Error("img " + r.text); files.push(r.json.file); }
  if (video) { const r = await upload(s, drop.id, media("small.mp4"), "vid.mp4", "video/mp4"); if (r.status !== 201) throw new Error("vid " + r.text); files.push(r.json.file); }
  let link = null; if (publish) { const p = await s.http.j("POST", `/api/drops/${drop.id}/publish`, { json: { attestation: att } }); if (p.status !== 200) throw new Error("publish " + p.text); link = p.json.drop.public_link_id; }
  return { drop, link, files };
}
