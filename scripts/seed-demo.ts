// Seeds demo data through the REAL API (+ a few SQL rows for things the API can't create yet: sales, payouts, flagged status).
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

  const sale = async (dropId: string, cents: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const platform = Math.round(cents * 0.1), processing = Math.round(cents * 0.029 + 30);
      await db.query(
        `INSERT INTO transactions (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, processor_ref, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' days')::interval)`,
        [dropId, mayaId, `buyer${i}@example.test`, cents, platform, processing, cents - platform - processing, `demo_${stamp}_${dropId.slice(0, 6)}_${i}`, String(i)],
      );
    }
  };
  await sale(spring.id, 1200, 18);
  await sale(studio.id, 2500, 7);
  await sale(travel.id, 800, 5);
  await db.query("INSERT INTO payouts (seller_id, amount_cents, status, provider_ref) VALUES ($1, 15000, 'paid', $2), ($1, 6000, 'pending', $3)", [mayaId, `po_${stamp}_1`, `po_${stamp}_2`]);

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
    sam: { email: samEmail }, jo: { email: joEmail, dropId: jd.id },
  };
  const fs = await import("node:fs");
  fs.mkdirSync(".e2e", { recursive: true });
  fs.writeFileSync(".e2e/seed.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
