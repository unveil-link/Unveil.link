// Seeds demo data through the REAL API and the REAL payments pipeline (mock processor: checkout -> pay -> refund/chargeback webhooks -> payouts service).
// usage: BASE_URL=http://localhost:3400 npx tsx scripts/seed-demo.ts      (needs .env for DATABASE_URL; idempotent per run via a unique suffix)
import { config } from "dotenv";
import sharp from "sharp";
import { Client } from "pg";
config({ path: ".env" });

const BASE = process.env.BASE_URL ?? "http://localhost:3400";
const PASSWORD = "Sunrise-Harbor-4821";
let ipN = 40;

class Session {
  cookie = "";
  ip = `10.77.${ipN++}.${Math.floor(Math.random() * 200) + 1}`;
  async req(method: string, path: string, opts: { json?: unknown; form?: FormData } = {}) {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, origin: BASE };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers, body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined) });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const kv = c.split(";")[0]; if (kv.includes("=")) this.cookie = kv; }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body)}`);
    return body;
  }
}

/** Soft abstract gradient art (neutral). */
async function art(i: number, w = 1200, h = 900): Promise<Buffer> {
  const palettes = [["#4f3be8", "#14b8a6"], ["#f7a8b8", "#7c6cf5"], ["#ffd28a", "#4f3be8"], ["#14b8a6", "#c38bf0"], ["#ff8a65", "#4f3be8"], ["#2dd4bf", "#fde68a"]];
  const [a, b] = palettes[i % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${200 + i * 90}" cy="260" r="190" fill="#fff" fill-opacity="0.35"/><circle cx="${w - 260}" cy="${h - 220 - i * 20}" r="260" fill="#14121f" fill-opacity="0.22"/>
  <rect x="${300 + i * 30}" y="${h / 2}" width="520" height="150" rx="75" fill="#fff" fill-opacity="0.5"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function upload(s: Session, dropId: string, i: number, name: string) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(await art(i))], { type: "image/jpeg" }), name);
  return s.req("POST", `/api/drops/${dropId}/files`, { form: fd });
}

async function main() {
  const stamp = Date.now().toString(36);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // --- Seller A: verified, populated
  const maya = new Session();
  const mayaEmail = `maya+${stamp}@example.test`;
  await maya.req("POST", "/api/auth/signup", { json: { email: mayaEmail, password: PASSWORD, displayName: "Maya Lin" } });
  await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [mayaEmail]);
  const mayaId = (await db.query("SELECT id FROM sellers WHERE email=$1", [mayaEmail])).rows[0].id as string;

  const mk = async (title: string, price: number, desc: string, nFiles: number, publish: boolean, off = 0) => {
    const d = (await maya.req("POST", "/api/drops", { json: { title, priceCents: price, description: desc } })).drop;
    for (let i = 0; i < nFiles; i++) await upload(maya, d.id, off + i, `${title.toLowerCase().replace(/\W+/g, "-")}-${i + 1}.jpg`);
    if (publish) await maya.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } } });
    return d as { id: string; public_link_id: string; price_cents: number };
  };
  const spring = await mk("Spring collection pack", 1200, "A set of 12 original edits from this season, shot on location. Full resolution, ready to use in your own projects.", 6, true, 0);
  const studio = await mk("Studio colour study", 2500, "Behind-the-scenes colour palette studies.", 3, true, 2);
  const travel = await mk("Travel set, vol. 2", 800, "Coastal walks and city light.", 4, true, 4);
  const draft = await mk("Autumn preview (draft)", 1500, "Work in progress.", 2, false, 1);
  const unpub = await mk("Winter archive", 3000, "Retired collection.", 2, true, 3);
  await maya.req("POST", `/api/drops/${unpub.id}/unpublish`);
  const flagged = await mk("Pop-up reel", 999, "Paused drop.", 1, false, 5);
  await db.query("UPDATE drops SET status='flagged' WHERE id=$1", [flagged.id]);

  // ---- Money: everything goes through the REAL payments pipeline (mock processor), so the ledger, fees and hold are exactly what
  // production code produces. Needs PAYMENT_WEBHOOK_SECRET and MOCK_PAYMENTS_ENABLED=1 in .env (loopback APP_URL only).
  const { mockEvents, signMockEvent } = await import("../src/server/payments/mock/events");
  const { requestPayout, approvePayout, markPayoutPaid } = await import("../src/server/payments/payouts");
  const { pool } = await import("../src/server/db");
  const setHold = (d: number) => db.query("UPDATE platform_settings SET payout_hold_days=$1 WHERE id=1", [d]);
  const setCbFee = (c: number) => db.query("UPDATE platform_settings SET chargeback_fee_cents=$1 WHERE id=1", [c]);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) throw new Error("PAYMENT_WEBHOOK_SECRET (>= 32 chars) must be set in .env to seed sales");

  let n = 0;
  /** buy one drop as an anonymous buyer; returns our transaction id */
  const buy = async (link: string): Promise<string> => {
    const buyer = new Session();
    const co = await buyer.req("POST", "/api/checkout", { json: { linkId: link, email: `buyer${n++}+${stamp}@example.test`, confirmOver18: true } });
    const sessionId = String(co.checkoutUrl).split("/").pop()!;
    const paid = await buyer.req("POST", "/api/dev/payments/pay", { json: { sessionId, card: "4242424242424242" } });
    if (paid.status !== "succeeded") throw new Error("mock payment did not succeed: " + JSON.stringify(paid));
    return co.transactionId as string;
  };
  const refund = (txId: string, amountCents?: number) => new Session().req("POST", "/api/dev/payments/refund", { json: { transactionId: txId, amountCents } });
  const chargeback = async (txId: string) => {
    const sgn = signMockEvent(mockEvents.chargeback({ transactionId: txId, amountCents: null }), secret);
    const res = await fetch(BASE + "/api/webhooks/mock", { method: "POST", headers: sgn.headers, body: sgn.rawBody });
    if (!res.ok) throw new Error("chargeback webhook -> " + res.status + " " + (await res.text()));
  };
  const buyMany = async (link: string, count: number) => { const ids: string[] = []; for (let i = 0; i < count; i++) ids.push(await buy(link)); return ids; };

  // Maya: older sales (hold 0 => already AVAILABLE), reversals, payouts; then fresh sales inside the 7-day hold (PENDING).
  await setHold(0);
  await buyMany(spring.public_link_id, 18);
  const studioTx = await buyMany(studio.public_link_id, 7);
  const travelTx = await buyMany(travel.public_link_id, 5);
  await refund(studioTx[0]);                 // full refund of a $25.00 sale
  await refund(studioTx[1], 1000);           // PARTIAL refund: $10.00 of a $25.00 sale
  await setCbFee(500);
  await chargeback(travelTx[0]);             // chargeback on a $8.00 sale + $5.00 chargeback fee
  await setCbFee(0);
  const paidOut = await requestPayout(mayaId, 15000);   // $150.00: requested -> approved -> paid
  await markPayoutPaid((await approvePayout(paidOut.id)).id);
  await requestPayout(mayaId, 6000);                    // $60.00: requested (funds reserved)
  await setHold(7);
  await buyMany(spring.public_link_id, 3);              // these 3 sales sit inside the hold -> "Pending"

  // Ned: negative balance. A $60.00 sale is paid out in full, then refunded afterwards => available < 0 ("you owe").
  const ned = new Session();
  const nedEmail = `ned+${stamp}@example.test`;
  await ned.req("POST", "/api/auth/signup", { json: { email: nedEmail, password: PASSWORD, displayName: "Ned Okafor" } });
  await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [nedEmail]);
  const nedId = (await db.query("SELECT id FROM sellers WHERE email=$1", [nedEmail])).rows[0].id as string;
  const nd = (await ned.req("POST", "/api/drops", { json: { title: "Print pack", priceCents: 6000, description: "Printable pack." } })).drop;
  await upload(ned, nd.id, 2, "print-pack-1.jpg");
  await ned.req("POST", `/api/drops/${nd.id}/publish`, { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } } });
  await setHold(0);
  const nedTx = await buy(nd.public_link_id);
  await markPayoutPaid((await approvePayout((await requestPayout(nedId)).id)).id);
  await refund(nedTx);
  await setHold(7);
  await pool().end();

  // --- Seller B: brand-new (empty state), pending verification
  const sam = new Session();
  const samEmail = `sam+${stamp}@example.test`;
  await sam.req("POST", "/api/auth/signup", { json: { email: samEmail, password: PASSWORD, displayName: "Sam Rivera" } });

  // --- Seller C: pending verification with one draft (shows locked-publish states)
  const jo = new Session();
  const joEmail = `jo+${stamp}@example.test`;
  await jo.req("POST", "/api/auth/signup", { json: { email: joEmail, password: PASSWORD, displayName: "Jo Park" } });
  const jd = (await jo.req("POST", "/api/drops", { json: { title: "Portfolio sampler", priceCents: 1000, description: "A small sampler." } })).drop;
  await upload(jo, jd.id, 1, "sampler-1.jpg");
  await db.end();

  const out = {
    base: BASE, password: PASSWORD,
    maya: { email: mayaEmail, links: { spring: spring.public_link_id, studio: studio.public_link_id, travel: travel.public_link_id, unpublished: unpub.public_link_id, draft: draft.public_link_id }, dropIds: { spring: spring.id, draft: draft.id, flagged: flagged.id } },
    sam: { email: samEmail }, jo: { email: joEmail, dropId: jd.id }, ned: { email: nedEmail },
  };
  const fs = await import("node:fs");
  fs.mkdirSync(".e2e", { recursive: true });
  fs.writeFileSync(".e2e/seed.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
