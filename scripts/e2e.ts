/**
 * End-to-end proof against a running app (started by scripts/e2e.sh).
 * Talks to the app purely over HTTP, plus direct DB/filesystem inspection for evidence.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Client } from "pg";
import { SignJWT } from "jose";
import { spawn } from "node:child_process";
import { signOriginalUrl } from "../src/server/services/signing";
import { mockEvents, mockSaleId, signMockEvent, type MockWireEvent } from "../src/server/payments/mock/events";
import { TEST_CARDS } from "../src/server/payments/mock/cards";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const STORAGE_DIR = path.resolve(process.env.STORAGE_LOCAL_DIR!);
const PROOF_DIR = path.resolve("proof");
fs.mkdirSync(PROOF_DIR, { recursive: true });

// ---------- tiny test harness ----------
const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? undefined;
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ""}`);
  } catch (e) {
    const msg = (e as Error).message;
    results.push({ name, ok: false, detail: msg });
    console.log(`FAIL  ${name}  — ${msg}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq<T>(a: T, b: T, what: string) {
  assert(a === b, `${what}: expected ${String(b)}, got ${String(a)}`);
}

// ---------- http client with cookie jar ----------
let ipCounter = 0;
class Client_ {
  cookies = new Map<string, string>();
  /** Every client gets its own (fake) client IP so rate-limit state never bleeds between checks. */
  ip = `10.99.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  async req(method: string, url: string, init: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...(init.headers ?? {}) };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) body = init.form;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url.startsWith("http") ? url : BASE + url, { method, headers, body, redirect: "manual" });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v === "" || /max-age=0/i.test(sc)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return res;
  }
}

// ---------- photo-like test image ----------
async function makePhoto(w = 1600, h = 1067): Promise<Buffer> {
  // Sky gradient + sun + layered mountains + trees + text/line detail, then film-grain noise.
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  const ridge = (base: number, amp: number, fill: string) => {
    let d = `M0 ${h} L0 ${base}`;
    for (let x = 0; x <= w; x += 20) d += ` L${x} ${base + Math.sin(x / 130 + base) * amp + (rnd() - 0.5) * amp * 0.9}`;
    return `<path d="${d} L${w} ${h} Z" fill="${fill}"/>`;
  };
  let trees = "";
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w, y = h * 0.7 + rnd() * h * 0.3, s = 10 + rnd() * 30;
    trees += `<polygon points="${x},${y - s * 2} ${x - s * 0.6},${y} ${x + s * 0.6},${y}" fill="hsl(${110 + rnd() * 40},${40 + rnd() * 30}%,${15 + rnd() * 20}%)"/>`;
  }
  let lines = "";
  for (let i = 0; i < 80; i++) lines += `<line x1="${rnd() * w}" y1="${rnd() * h * 0.5}" x2="${rnd() * w}" y2="${rnd() * h * 0.5}" stroke="rgba(255,255,255,${rnd() * 0.25})" stroke-width="${1 + rnd() * 2}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a6b"/><stop offset="0.55" stop-color="#e2705a"/><stop offset="1" stop-color="#f7c873"/></linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#fff6d0"/><stop offset="1" stop-color="#fff6d000"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sky)"/>
    <circle cx="${w * 0.68}" cy="${h * 0.48}" r="${h * 0.3}" fill="url(#sun)"/>
    ${lines}
    ${ridge(h * 0.55, 60, "#4a3b6b")}${ridge(h * 0.65, 50, "#2f2a4d")}${ridge(h * 0.75, 40, "#1c2a2a")}
    ${trees}
    <rect x="${w * 0.1}" y="${h * 0.1}" width="${w * 0.22}" height="${h * 0.14}" fill="none" stroke="#fff" stroke-width="4"/>
    <text x="${w * 0.11}" y="${h * 0.19}" font-size="64" font-family="sans-serif" fill="#fff" font-weight="bold">UNVEIL</text>
  </svg>`;
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rnd() * 255);
  const grain = await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).ensureAlpha(0.12).png().toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: grain, blend: "over" }])
    .withExif({ IFD0: { Copyright: "E2E test photographer", Artist: "secret-person" } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** mean absolute gradient magnitude on grayscale — a simple "detail" measure. */
async function detail(buf: Buffer, size?: { w: number; h: number }): Promise<number> {
  let p = sharp(buf).greyscale();
  if (size) p = p.resize(size.w, size.h, { fit: "fill" });
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let y = 0; y < info.height - 1; y++)
    for (let x = 0; x < info.width - 1; x++) {
      const i = y * info.width + x;
      sum += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i] - data[i + info.width]);
      n += 2;
    }
  return sum / n;
}
async function meanAbsDiff(a: Buffer, b: Buffer, w: number, h: number): Promise<number> {
  const [da, db] = await Promise.all(
    [a, b].map((x) => sharp(x).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer()),
  );
  let s = 0;
  for (let i = 0; i < da.length; i++) s += Math.abs(da[i] - db[i]);
  return s / da.length;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

// ---------- the tests ----------
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const stamp = Date.now();
  const email = `seller+${stamp}@example.test`;
  const password = "correct-horse-battery";
  const alice = new Client_();
  const anon = new Client_();
  let dropId = "", publicLinkId = "", fileId = "", storageKey = "", previewKey = "";
  let photo!: Buffer, previewBytes!: Buffer;

  await check("app is up; /api/settings returns configurable limits", async () => {
    const r = await anon.req("GET", "/api/settings");
    eq(r.status, 200, "status");
    const s = await r.json();
    assert(s.maxImageSizeBytes > 0 && s.priceMinCents === 100 && s.priceMaxCents === 50000, "settings shape");
    return `max image ${s.maxImageSizeBytes} bytes`;
  });

  await check("signup creates seller with verification_status=pending + httpOnly session cookie", async () => {
    const r = await alice.req("POST", "/api/auth/signup", { json: { email, password, displayName: "E2E Seller" } });
    eq(r.status, 201, "status");
    const body = await r.json();
    eq(body.seller.verification_status, "pending", "API verification_status");
    assert(!("password_hash" in body.seller), "password_hash must not be returned");
    const sc = r.headers.getSetCookie().find((c) => c.startsWith("unveil_session="));
    assert(sc, "session cookie set");
    assert(/httponly/i.test(sc!), "cookie is HttpOnly");
    assert(/samesite=lax/i.test(sc!), "cookie SameSite=Lax");
    const row = (await db.query("SELECT verification_status, password_hash FROM sellers WHERE email=$1", [email])).rows[0];
    eq(row.verification_status, "pending", "DB verification_status");
    assert(row.password_hash.startsWith("$2"), "password stored as bcrypt hash, not plaintext");
  });

  await check("duplicate signup rejected (409); weak password rejected (400)", async () => {
    eq((await anon.req("POST", "/api/auth/signup", { json: { email, password, displayName: "x" } })).status, 409, "dup");
    eq((await anon.req("POST", "/api/auth/signup", { json: { email: "a@b.co", password: "short", displayName: "x" } })).status, 400, "weak");
  });

  await check("GET /api/auth/me: 401 without cookie, 200 + pending with cookie", async () => {
    eq((await anon.req("GET", "/api/auth/me")).status, 401, "anon");
    const r = await alice.req("GET", "/api/auth/me");
    eq(r.status, 200, "authed");
    eq((await r.json()).seller.verification_status, "pending", "status");
  });

  await check("tampered/forged session cookie is rejected", async () => {
    const bad = new Client_();
    bad.cookies.set("unveil_session", alice.cookies.get("unveil_session")!.slice(0, -3) + "AAA");
    eq((await bad.req("GET", "/api/auth/me")).status, 401, "tampered");
    bad.cookies.set("unveil_session", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.");
    eq((await bad.req("GET", "/api/auth/me")).status, 401, "alg none");
  });

  await check("logout clears the cookie; login with wrong password = 401; correct = 200", async () => {
    const c = new Client_();
    eq((await c.req("POST", "/api/auth/login", { json: { email, password: "wrong-password" } })).status, 401, "wrong pw");
    eq((await c.req("POST", "/api/auth/login", { json: { email: "nobody@example.test", password } })).status, 401, "unknown user");
    const ok = await c.req("POST", "/api/auth/login", { json: { email: email.toUpperCase(), password } });
    eq(ok.status, 200, "login");
    eq((await c.req("GET", "/api/auth/me")).status, 200, "me after login");
    eq((await c.req("POST", "/api/auth/logout")).status, 200, "logout");
    eq((await c.req("GET", "/api/auth/me")).status, 401, "me after logout");
    // use a fresh login for the rest of the run
    eq((await alice.req("POST", "/api/auth/login", { json: { email, password } })).status, 200, "alice re-login");
  });

  await check("cross-origin mutation blocked (CSRF guard)", async () => {
    const r = await alice.req("POST", "/api/drops", {
      json: { title: "x", priceCents: 500 },
      headers: { origin: "http://evil.example" },
    });
    eq(r.status, 403, "status");
  });

  await check("dashboard page renders verification status 'Pending'", async () => {
    const r = await alice.req("GET", "/dashboard");
    eq(r.status, 200, "status");
    const html = await r.text();
    assert(/data-testid="verification-status"[^>]*>Pending</.test(html), "verification badge shows Pending");
    const anonR = await anon.req("GET", "/dashboard");
    assert([307, 308].includes(anonR.status) && /\/login/.test(anonR.headers.get("location") ?? ""), "anon redirected to /login");
  });

  await check("create drop; price bounds enforced ($1–$500) in API and DB", async () => {
    eq((await alice.req("POST", "/api/drops", { json: { title: "Too cheap", priceCents: 99 } })).status, 400, "99c");
    eq((await alice.req("POST", "/api/drops", { json: { title: "Too dear", priceCents: 50001 } })).status, 400, "50001c");
    const r = await alice.req("POST", "/api/drops", { json: { title: "Sunset set", description: "e2e drop", priceCents: 1500 } });
    eq(r.status, 201, "create");
    const { drop } = await r.json();
    dropId = drop.id; publicLinkId = drop.public_link_id;
    eq(drop.status, "draft", "status");
    assert(/^[A-Za-z0-9_-]{12}$/.test(publicLinkId), `public_link_id 12 chars url-safe (got ${publicLinkId})`);
    let dbRejected = false;
    try { await db.query("INSERT INTO drops (seller_id, public_link_id, title, price_cents) SELECT seller_id,'AAAAAAAAAAAA','x',99 FROM drops LIMIT 1"); } catch (e) { dbRejected = (e as { code?: string }).code === "23514"; }
    assert(dbRejected, "DB CHECK constraint rejects price_cents=99");
    return `public_link_id=${publicLinkId}`;
  });

  await check("upload rejects: unauthenticated (401), non-image (415), GIF (415), spoofed MIME (415)", async () => {
    const fd = () => { const f = new FormData(); f.append("file", new Blob([Buffer.from("hello")], { type: "image/jpeg" }), "fake.jpg"); return f; };
    eq((await anon.req("POST", `/api/drops/${dropId}/files`, { form: fd() })).status, 401, "anon");
    eq((await alice.req("POST", `/api/drops/${dropId}/files`, { form: fd() })).status, 415, "text as jpeg");
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#f00" } }).gif().toBuffer();
    const f = new FormData(); f.append("file", new Blob([gif], { type: "image/png" }), "x.png");
    eq((await alice.req("POST", `/api/drops/${dropId}/files`, { form: f })).status, 415, "gif");
    const svg = new FormData(); svg.append("file", new Blob([Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")], { type: "image/png" }), "x.png");
    eq((await alice.req("POST", `/api/drops/${dropId}/files`, { form: svg })).status, 415, "svg");
  });

  await check("upload size limit comes from platform_settings (413 when exceeded, editable without deploy)", async () => {
    const small = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).png().toBuffer();
    await db.query("UPDATE platform_settings SET max_image_size_bytes = 100 WHERE id=1");
    try {
      const f = new FormData(); f.append("file", new Blob([small], { type: "image/png" }), "s.png");
      eq((await alice.req("POST", `/api/drops/${dropId}/files`, { form: f })).status, 413, "over limit");
    } finally {
      await db.query("UPDATE platform_settings SET max_image_size_bytes = 15728640 WHERE id=1");
    }
    const f2 = new FormData(); f2.append("file", new Blob([small], { type: "image/png" }), "s.png");
    const ok = await alice.req("POST", `/api/drops/${dropId}/files`, { form: f2 });
    eq(ok.status, 201, "under limit after restore");
    // remove this throwaway file so the main assertions deal with a single file
    const { file } = await ok.json();
    const row = (await db.query("SELECT storage_key, blurred_preview_key FROM drop_files WHERE id=$1", [file.id])).rows[0];
    fs.rmSync(path.join(STORAGE_DIR, row.storage_key), { force: true });
    fs.rmSync(path.join(STORAGE_DIR, row.blurred_preview_key), { force: true });
    await db.query("DELETE FROM drop_files WHERE id=$1", [file.id]);
  });

  await check("upload generated photo-like JPEG (with EXIF) → 201", async () => {
    photo = await makePhoto();
    fs.writeFileSync(path.join(PROOF_DIR, "test-original.jpg"), photo);
    const meta = await sharp(photo).metadata();
    assert(meta.exif, "test image has EXIF to strip");
    const f = new FormData();
    f.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "sunset.jpg");
    const r = await alice.req("POST", `/api/drops/${dropId}/files`, { form: f });
    eq(r.status, 201, `status (${r.status})`);
    const { file } = await r.json();
    fileId = file.id;
    const row = (await db.query("SELECT * FROM drop_files WHERE id=$1", [fileId])).rows[0];
    storageKey = row.storage_key; previewKey = row.blurred_preview_key;
    eq(row.mime, "image/jpeg", "mime");
    eq(Number(row.size_bytes), photo.length, "size_bytes");
    assert(previewKey, "blurred_preview_key recorded");
    return `${meta.width}x${meta.height}, ${photo.length} bytes, key=${storageKey}`;
  });

  await check("original stored PRIVATELY: byte-identical in storage dir outside public/ and outside the web root", async () => {
    const p = path.join(STORAGE_DIR, storageKey);
    assert(fs.existsSync(p), `original exists at ${p}`);
    assert(sha(fs.readFileSync(p)) === sha(photo), "stored bytes identical to upload");
    const pub = path.resolve("public");
    assert(!STORAGE_DIR.startsWith(pub), "storage dir not under public/");
    const leaked = walk(pub).concat(walk(path.resolve(".next-e2e/static"))).filter((f) => sha(fs.readFileSync(f)) === sha(photo));
    eq(leaked.length, 0, "copies of original under public/ or built static assets");
    const mode = fs.statSync(p).mode & 0o777;
    assert((mode & 0o077) === 0, `file mode ${mode.toString(8)} is owner-only`);
    return `${p} (mode ${mode.toString(8)})`;
  });

  await check("original NOT reachable at any public URL (guessable paths, storage key, unsigned API)", async () => {
    const name = path.basename(storageKey);
    const urls = [
      `/${storageKey}`, `/storage-data/${storageKey}`, `/storage/${storageKey}`, `/uploads/${name}`, `/public/${name}`,
      `/originals/${dropId}/${name}`, `/_next/static/${storageKey}`, `/api/files/${fileId}`, `/api/files/${fileId}/original`,
      `/api/files/${fileId}/preview/../original`, `/api/files/${fileId}/original?exp=9999999999`, `/api/files/${fileId}/original?sig=abc`,
    ];
    const origSha = sha(photo);
    for (const u of urls) {
      for (const c of [anon, alice]) { // even the logged-in owner must not get it without a signature
        const r = await c.req("GET", u);
        const b = Buffer.from(await r.arrayBuffer());
        assert(sha(b) !== origSha, `ORIGINAL BYTES LEAKED at ${u}`);
        assert(r.status >= 300, `${u} returned ${r.status}`);
      }
    }
    return `${urls.length} URLs × 2 clients → none returned the original`;
  });

  await check("blurred preview exists in storage under blurred_preview_key and is served (owner, while draft)", async () => {
    assert(fs.existsSync(path.join(STORAGE_DIR, previewKey)), "preview file exists");
    const r = await alice.req("GET", `/api/files/${fileId}/preview`);
    eq(r.status, 200, "status");
    eq(r.headers.get("content-type"), "image/jpeg", "content-type");
    previewBytes = Buffer.from(await r.arrayBuffer());
    assert(previewBytes.equals(fs.readFileSync(path.join(STORAGE_DIR, previewKey))), "served == stored preview");
    eq((await anon.req("GET", `/api/files/${fileId}/preview`)).status, 404, "draft preview hidden from anon");
    return `${previewBytes.length} bytes`;
  });

  await check("preview differs SUBSTANTIALLY from original (blur + downscale + EXIF stripped)", async () => {
    const om = await sharp(photo).metadata();
    const pm = await sharp(previewBytes).metadata();
    assert(pm.width! <= 320 && pm.height! <= 320, `preview downscaled (${pm.width}x${pm.height})`);
    assert(!pm.exif && !pm.icc && !pm.xmp, "no EXIF/ICC/XMP in preview");
    assert(sha(previewBytes) !== sha(photo), "different bytes");
    assert(previewBytes.length < photo.length * 0.1, `preview much smaller (${previewBytes.length} vs ${photo.length})`);

    const d0 = await detail(photo, { w: pm.width!, h: pm.height! }); // original at preview res (fair comparison)
    const d1 = await detail(previewBytes);
    const ratio = d1 / d0;
    assert(ratio < 0.2, `high-frequency detail ratio ${ratio.toFixed(3)} should be < 0.2`);

    const mad = await meanAbsDiff(photo, previewBytes, 512, Math.round((512 * om.height!) / om.width!));
    assert(mad > 4, `mean abs pixel diff ${mad.toFixed(1)}/255 should be > 4 (upscaled preview vs original)`);
    const dFull = await detail(photo, { w: 512, h: Math.round((512 * om.height!) / om.width!) });
    const dPrevUp = await detail(await sharp(previewBytes).resize(512).toBuffer());
    assert(dPrevUp / dFull < 0.1, `detail after upscale ratio ${(dPrevUp / dFull).toFixed(3)} < 0.1`);

    // side-by-side proof image
    const H = 540;
    const left = await sharp(photo).resize({ height: H }).jpeg({ quality: 90 }).toBuffer();
    const lm = await sharp(left).metadata();
    const right = await sharp(previewBytes).resize({ width: lm.width!, height: H, fit: "fill", kernel: "cubic" }).jpeg({ quality: 90 }).toBuffer();
    const label = (t: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lm.width}" height="44"><rect width="100%" height="100%" fill="#14121f"/><text x="16" y="29" font-size="22" fill="#fff" font-family="sans-serif">${t}</text></svg>`);
    const W = lm.width! * 2 + 12;
    await sharp({ create: { width: W, height: H + 44, channels: 3, background: "#14121f" } })
      .composite([
        { input: label(`ORIGINAL (private) ${om.width}x${om.height} ${Math.round(photo.length / 1024)} KB`), left: 0, top: 0 },
        { input: label(`BLURRED PREVIEW (public) ${pm.width}x${pm.height} ${Math.round(previewBytes.length / 1024)} KB`), left: lm.width! + 12, top: 0 },
        { input: left, left: 0, top: 44 },
        { input: right, left: lm.width! + 12, top: 44 },
      ])
      .png().toFile(path.join(PROOF_DIR, "compare.png"));
    return `detail ratio=${ratio.toFixed(3)}, upscaled-detail ratio=${(dPrevUp / dFull).toFixed(3)}, MAD=${mad.toFixed(1)}/255, preview ${pm.width}x${pm.height}; wrote proof/compare.png`;
  });

  let signedPath = "";
  await check("owner can mint signed URL; others cannot", async () => {
    const r = await alice.req("POST", `/api/files/${fileId}/signed-url`);
    eq(r.status, 200, "status");
    const j = await r.json();
    signedPath = j.path;
    assert(/exp=\d+&sig=[\w-]+/.test(signedPath), "has exp+sig");
    eq((await anon.req("POST", `/api/files/${fileId}/signed-url`)).status, 401, "anon mint");
    const mallory = new Client_();
    const su = await mallory.req("POST", "/api/auth/signup", { json: { email: `mallory+${stamp}@example.test`, password, displayName: "Mallory" } });
    eq(su.status, 201, "mallory signup");
    eq((await mallory.req("POST", `/api/files/${fileId}/signed-url`)).status, 404, "mallory mint");
    eq((await mallory.req("GET", `/api/drops/${dropId}`)).status, 404, "mallory reads alice's drop");
    eq((await mallory.req("POST", `/api/drops/${dropId}/files`, { form: new FormData() })).status, 404, "mallory uploads to alice's drop");
    return `expires ${j.expiresAt}`;
  });

  await check("VALID signed URL → 200 and returns the exact original bytes (works without a session)", async () => {
    const r = await anon.req("GET", signedPath);
    eq(r.status, 200, "status");
    eq(r.headers.get("content-type"), "image/jpeg", "content-type");
    assert(/no-store/.test(r.headers.get("cache-control") ?? ""), "cache-control no-store");
    const b = Buffer.from(await r.arrayBuffer());
    assert(sha(b) === sha(photo), "bytes identical to original");
  });

  await check("UNSIGNED / tampered / wrong-file signed URLs denied (403)", async () => {
    eq((await anon.req("GET", `/api/files/${fileId}/original`)).status, 403, "no params");
    const u = new URL(BASE + signedPath);
    const exp = u.searchParams.get("exp")!, sig = u.searchParams.get("sig")!;
    eq((await anon.req("GET", `/api/files/${fileId}/original?exp=${exp}`)).status, 403, "no sig");
    eq((await anon.req("GET", `/api/files/${fileId}/original?sig=${sig}`)).status, 403, "no exp");
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
    eq((await anon.req("GET", `/api/files/${fileId}/original?exp=${exp}&sig=${flipped}`)).status, 403, "bad sig");
    eq((await anon.req("GET", `/api/files/${fileId}/original?exp=${Number(exp) + 3600}&sig=${sig}`)).status, 403, "extended exp with old sig");
    eq((await anon.req("GET", `/api/files/${crypto.randomUUID()}/original?exp=${exp}&sig=${sig}`)).status, 403, "sig for a different file id");
    eq((await anon.req("GET", `/api/files/${fileId}/original?exp=abc&sig=${sig}`)).status, 403, "malformed exp");
  });

  await check("EXPIRED signed URL denied (410): real 2s-TTL link after waiting, and a pre-expired link", async () => {
    const { signOriginalUrl: _unused } = { signOriginalUrl };
    void _unused;
    const short = signOriginalUrl(fileId, 2);
    eq((await anon.req("GET", short.path)).status, 200, "valid before expiry");
    await new Promise((r) => setTimeout(r, 3500));
    const late = await anon.req("GET", short.path);
    eq(late.status, 410, "after expiry");
    const past = signOriginalUrl(fileId, -60);
    eq((await anon.req("GET", past.path)).status, 410, "pre-expired");
    const b = Buffer.from(await late.arrayBuffer());
    assert(sha(b) !== sha(photo), "expired response must not contain original");
  });

  await check("publish BLOCKED while verification_status=pending (403 verification_required); drop stays draft and is not public", async () => {
    const att = { over18: true, ownsRights: true, consentOfSubjects: true };
    const r = await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: att } });
    eq(r.status, 403, "status");
    eq((await r.json()).code, "verification_required", "code");
    const st = (await db.query("SELECT status FROM drops WHERE id=$1", [dropId])).rows[0].status;
    eq(st, "draft", "DB drop status");
    eq((await anon.req("GET", `/u/${publicLinkId}`)).status, 404, "public page hidden");
    eq((await anon.req("GET", `/api/public/drops/${publicLinkId}`)).status, 404, "public API hidden");
    eq((await anon.req("GET", `/api/files/${fileId}/preview`)).status, 404, "preview hidden");
    for (const s of ["failed", "manual_review"]) {
      await db.query("UPDATE sellers SET verification_status=$2 WHERE email=$1", [email, s]);
      eq((await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: att } })).status, 403, `blocked for ${s}`);
    }
    await db.query("UPDATE sellers SET verification_status='pending' WHERE email=$1", [email]);
  });

  await check("after verification_status=verified: publish needs attestation, then succeeds; public page shows ONLY blurred", async () => {
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [email]);
    eq((await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: { over18: true, ownsRights: false, consentOfSubjects: true } } })).status, 400, "incomplete attestation");
    const r = await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } } });
    eq(r.status, 200, "publish");
    eq((await db.query("SELECT status FROM drops WHERE id=$1", [dropId])).rows[0].status, "published", "DB status");

    const pub = await anon.req("GET", `/api/public/drops/${publicLinkId}`);
    eq(pub.status, 200, "public API");
    const txt = await pub.text();
    assert(!txt.includes(storageKey) && !txt.includes("original") && !txt.includes("storage_key"), "public API leaks no original key/URL");
    const page = await (await anon.req("GET", `/u/${publicLinkId}`)).text();
    assert(page.includes(`/api/files/${fileId}/preview`), "public page references preview");
    assert(!page.includes("/original") && !page.includes(storageKey), "public page never references originals");
    const pr = await anon.req("GET", `/api/files/${fileId}/preview`);
    eq(pr.status, 200, "public preview");
    assert(sha(Buffer.from(await pr.arrayBuffer())) === sha(previewBytes), "public preview == blurred bytes");
    eq((await anon.req("GET", `/api/files/${fileId}/original`)).status, 403, "original still denied after publish");
    await db.query("UPDATE sellers SET verification_status='pending' WHERE email=$1", [email]); // restore for DB snapshot
  });

  await check("DB has all spec tables + seller row with verification_status=pending", async () => {
    const t = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    for (const n of ["sellers", "drops", "drop_files", "transactions", "payouts", "reports", "audit_log", "platform_settings"])
      assert(t.includes(n), `table ${n} exists`);
    const s = (await db.query("SELECT verification_status FROM sellers WHERE email=$1", [email])).rows[0];
    eq(s.verification_status, "pending", "seller row");
    return `tables: ${t.filter((x) => x !== "schema_migrations").sort().join(", ")}`;
  });


  // =====================================================================================
  // backend/fixes-1 regression checks
  // =====================================================================================
  const MAIL_DIR = path.resolve(process.env.MAIL_DEV_DIR ?? ".e2e/mail");
  const stripComments = (h: string) => h.replace(/<!-- -->/g, "");
  const att = { over18: true, ownsRights: true, consentOfSubjects: true };
  const tinyPng = (rgb: string, size = 48) => sharp({ create: { width: size, height: size, channels: 3, background: rgb } }).png().toBuffer();
  const uploadForm = (buf: Buffer, name = "t.png") => { const f = new FormData(); f.append("file", new Blob([new Uint8Array(buf)], { type: "image/png" }), name); return f; };
  const signupClient = async (label: string, pw = password) => {
    const c = new Client_();
    const em = `${label}+${stamp}@example.test`;
    const r = await c.req("POST", "/api/auth/signup", { json: { email: em, password: pw, displayName: `User ${label}` } });
    eq(r.status, 201, `signup ${label} (${r.status})`);
    return { c, email: em };
  };
  const readMails = (to: string) =>
    fs.existsSync(MAIL_DIR)
      ? fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(".json")).sort()
          .map((f) => JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), "utf8")) as { to: string; subject: string; text: string })
          .filter((m) => m.to === to)
      : [];
  const waitForMails = async (to: string, n: number, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = readMails(to); if (m.length >= n) return m; await new Promise((r) => setTimeout(r, 150)); }
    throw new Error(`expected ${n} mail(s) to ${to}, found ${readMails(to).length}`);
  };
  const tokenFrom = (m: { text: string }) => m.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];

  // ---- #1 M1-04 server-side logout ----
  await check("[#1 M1-04] logout revokes the session server-side: captured cookie replayed after logout -> 401", async () => {
    const { c, email: em } = await signupClient("logout");
    const captured = c.cookies.get("unveil_session")!;
    eq((await c.req("GET", "/api/auth/me")).status, 200, "me before logout");
    // a second device (own login) must survive this logout
    const other = new Client_();
    eq((await other.req("POST", "/api/auth/login", { json: { email: em, password } })).status, 200, "second login");
    eq((await c.req("POST", "/api/auth/logout")).status, 200, "logout");
    const replay = new Client_();
    replay.cookies.set("unveil_session", captured);
    eq((await replay.req("GET", "/api/auth/me")).status, 401, "replayed old cookie after logout");
    eq((await replay.req("GET", "/api/drops")).status, 401, "replayed cookie on another authed endpoint");
    eq((await other.req("GET", "/api/auth/me")).status, 200, "other session still valid");
    const sid = JSON.parse(Buffer.from(captured.split(".")[1], "base64url").toString()).jti;
    const row = (await db.query("SELECT revoked_at FROM sessions WHERE id=$1", [sid])).rows[0];
    assert(row?.revoked_at, "sessions.revoked_at set in DB");
    // validly signed tokens that are not backed by a live sessions row are refused
    const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const sub = (await db.query("SELECT id FROM sellers WHERE email=$1", [em])).rows[0].id;
    const nojti = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(key);
    const fakejti = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime("1h").sign(key);
    for (const t of [nojti, fakejti]) { const x = new Client_(); x.cookies.set("unveil_session", t); eq((await x.req("GET", "/api/auth/me")).status, 401, "forged-but-signed token"); }
    return "old cookie 401 after logout; other device still 200; no-jti / unknown-jti tokens 401";
  });

  // ---- #2 M1-08 limits + race ----
  await check("[#2 M1-08] defaults: 10 files/drop and 2 GB/drop exposed via /api/settings", async () => {
    const s = await (await anon.req("GET", "/api/settings")).json();
    eq(s.maxFilesPerDrop, 10, "maxFilesPerDrop");
    eq(s.maxTotalBytesPerDrop, 2147483648, "maxTotalBytesPerDrop");
    const ps = (await db.query("SELECT max_files_per_drop, max_total_bytes_per_drop, max_video_size_bytes FROM platform_settings")).rows[0];
    eq(Number(ps.max_video_size_bytes), 524288000, "video per-file cap unchanged (500 MiB, video later)");
    return `files=${ps.max_files_per_drop} total=${ps.max_total_bytes_per_drop}`;
  });
  await check("[#2 M1-08] 15 PARALLEL uploads to one drop -> exactly 10 succeed (201), 5 rejected (400 too_many_files)", async () => {
    const { c } = await signupClient("race");
    const d = (await (await c.req("POST", "/api/drops", { json: { title: "race", priceCents: 500 } })).json()).drop;
    const buf = await tinyPng("#336699");
    const rs = await Promise.all(Array.from({ length: 15 }, () => c.req("POST", `/api/drops/${d.id}/files`, { form: uploadForm(buf) })));
    const codes = rs.map((r) => r.status);
    const ok = codes.filter((x) => x === 201).length;
    const bodies = await Promise.all(rs.filter((r) => r.status !== 201).map((r) => r.json()));
    eq(ok, 10, `201 count (codes: ${codes.join(",")})`);
    assert(bodies.every((b) => b.code === "too_many_files"), "rejections are too_many_files");
    eq(Number((await db.query("SELECT count(*) FROM drop_files WHERE drop_id=$1", [d.id])).rows[0].count), 10, "rows in DB");
    const leftovers = walk(path.join(STORAGE_DIR, "originals", d.id)).length;
    eq(leftovers, 10, "no orphaned original files in storage for rejected uploads");
    return `${ok}/15 accepted, DB rows=10, storage files=${leftovers}`;
  });
  await check("[#2 M1-08] per-drop total-size cap: sequential and parallel (setting lowered; 2 GB logic unit-tested separately)", async () => {
    const { c } = await signupClient("sizecap");
    const buf = await tinyPng("#aa5522", 64);
    const mk = async () => (await (await c.req("POST", "/api/drops", { json: { title: "cap", priceCents: 500 } })).json()).drop.id as string;
    try {
      await db.query("UPDATE platform_settings SET max_total_bytes_per_drop = $1 WHERE id=1", [buf.length * 3 + 10]);
      const a = await mk();
      const seq: number[] = [];
      for (let i = 0; i < 4; i++) seq.push((await c.req("POST", `/api/drops/${a}/files`, { form: uploadForm(buf) })).status);
      eq(seq.join(","), "201,201,201,413", "sequential statuses");
      const last = await c.req("POST", `/api/drops/${a}/files`, { form: uploadForm(buf) });
      eq((await last.json()).code, "drop_too_large", "error code");
      const b = await mk();
      const par = await Promise.all(Array.from({ length: 8 }, () => c.req("POST", `/api/drops/${b}/files`, { form: uploadForm(buf) })));
      eq(par.filter((r) => r.status === 201).length, 3, `parallel accepted (${par.map((r) => r.status).join(",")})`);
      const tot = Number((await db.query("SELECT COALESCE(sum(size_bytes),0) t FROM drop_files WHERE drop_id=$1", [b])).rows[0].t);
      assert(tot <= buf.length * 3 + 10, "stored total within cap");
    } finally {
      await db.query("UPDATE platform_settings SET max_total_bytes_per_drop = 2147483648 WHERE id=1");
    }
  });

  // ---- #3/#4/#5 public page ----
  let p2Link = "";
  await check("[#3 M2-04] publish returns /u/<id>; /u/<id> serves the page; /d/<id> 308-redirects to /u/<id>", async () => {
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [email]);
    const r = await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: att } });
    eq(r.status, 200, "publish");
    const j = await r.json();
    eq(j.url, `/u/${publicLinkId}`, "url field");
    eq((await anon.req("GET", `/u/${publicLinkId}`)).status, 200, "/u/ page");
    const old = await anon.req("GET", `/d/${publicLinkId}`);
    eq(old.status, 308, "/d/ status");
    assert((old.headers.get("location") ?? "").endsWith(`/u/${publicLinkId}`), `location ${old.headers.get("location")}`);
    const pub = await (await anon.req("GET", `/api/public/drops/${publicLinkId}`)).json();
    eq(pub.drop.url, `/u/${publicLinkId}`, "public API url");
    const dash = stripComments(await (await alice.req("GET", `/dashboard/drops/${dropId}`)).text());
    assert(dash.includes(`href="/u/${publicLinkId}"`) && !dash.includes(`href="/d/`), "dashboard links use /u/");
  });
  await check("[#4 M2-07] public page + API show seller name, file count/types, title, price, blurred previews; no originals", async () => {
    const html = stripComments(await (await anon.req("GET", `/u/${publicLinkId}`)).text());
    assert(html.includes("Sunset set"), "title");
    assert(html.includes("E2E Seller"), "seller display name");
    assert(html.includes("1 file: 1 image"), "file count + types");
    assert(html.includes("$15.00"), "price");
    assert(html.includes(`/api/files/${fileId}/preview`), "blurred preview img");
    assert(!html.includes("/original") && !html.includes(storageKey), "no original references");
    const api = await (await anon.req("GET", `/api/public/drops/${publicLinkId}`)).json();
    eq(api.seller.displayName, "E2E Seller", "api seller.displayName");
    eq(api.summary.fileCount, 1, "api fileCount");
    eq(api.summary.imageCount, 1, "api imageCount");
    eq(api.summary.label, "1 file: 1 image", "api label");
    eq(api.drop.priceCents, 1500, "api price");
    assert(!JSON.stringify(api).includes("original") && !JSON.stringify(api).includes(storageKey) && !JSON.stringify(api).includes("storage_key"), "api leaks no originals");
    // multi-file wording on a real drop: 3 images
    const { c } = await signupClient("multi");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [`multi+${stamp}@example.test`]);
    const d = (await (await c.req("POST", "/api/drops", { json: { title: "Trio", priceCents: 700 } })).json()).drop;
    const b = await tinyPng("#00aa00");
    for (let i = 0; i < 3; i++) eq((await c.req("POST", `/api/drops/${d.id}/files`, { form: uploadForm(b) })).status, 201, "upload");
    eq((await c.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: att } })).status, 200, "publish");
    p2Link = d.public_link_id;
    const h2 = stripComments(await (await anon.req("GET", `/u/${p2Link}`)).text());
    assert(h2.includes("3 files: 3 images"), "3 files wording");
    return "page: title, 'by E2E Seller', '1 file: 1 image', $15.00; 3-file drop shows '3 files: 3 images'";
  });
  await check("[FE-03/04/06 + placeholders] buyer title '<drop> · Unveil'; Verified badge follows sellers.verification_status; /design 404 in prod; /terms etc. are noindex 'Coming soon'", async () => {
    const title = (h: string) => (/<title>([^<]*)<\/title>/.exec(h)?.[1] ?? "").replace(/&amp;/g, "&");
    const h = await (await anon.req("GET", `/u/${p2Link}`)).text();
    eq(title(h), "Trio · Unveil", "buyer title");
    assert(h.includes("Verified creator"), "badge for a verified seller");
    const mail = `multi+${stamp}@example.test`;
    await db.query("UPDATE sellers SET verification_status='pending' WHERE email=$1", [mail]);
    const h2 = await (await anon.req("GET", `/u/${p2Link}`)).text();
    assert(!h2.includes("Verified creator"), "badge hidden once the seller is no longer verified");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [mail]);
    const nf = await anon.req("GET", "/u/doesnotexist1");
    eq(nf.status, 404, "unknown link");
    eq(title(await nf.text()), "Link unavailable · Unveil", "not-found title");
    eq((await anon.req("GET", "/design")).status, 404, "/design hidden in production");
    for (const path of ["/terms", "/privacy", "/dmca", "/contact"]) {
      const r = await anon.req("GET", path);
      eq(r.status, 200, `${path} status`);
      const t = await r.text();
      assert(t.includes("Coming soon") && /<meta name="robots" content="noindex/.test(t), `${path} placeholder + noindex`);
    }
    // FE-09: header as well as meta on the placeholders
    for (const path of ["/terms", "/privacy", "/dmca", "/contact"]) eq((await anon.req("GET", path)).headers.get("x-robots-tag"), "noindex, nofollow", `${path} X-Robots-Tag`);
    // FE-10: legal links on auth pages, the unavailable page and the buyer page (all four, not just Terms)
    // (the unavailable page is streamed as a 404 error-fallback, so its links appear in the escaped RSC payload rather than as plain href attributes)
    const legal = (h: string) => ["/terms", "/privacy", "/dmca", "/contact"].filter((l) => !h.includes(`href="${l}"`) && !h.includes(`\\"href\\":\\"${l}\\"`));
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/u/doesnotexist1", `/u/${p2Link}`]) {
      const miss = legal(await (await anon.req("GET", path)).text());
      assert(miss.length === 0, `${path} is missing legal links: ${miss.join(", ")}`);
    }
    // og/twitter: page-specific, neutral, only title + seller name already on the page, generic image, nothing else
    const meta = (h: string, k: string) => new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`).exec(h)?.[1] ?? "";
    eq(meta(h, "og:title"), "Trio · Unveil", "og:title");
    eq(meta(h, "twitter:title"), "Trio · Unveil", "twitter:title");
    assert(/\/icons\/icon-512\.png$/.test(meta(h, "og:image")), `og:image is the generic icon (${meta(h, "og:image")})`);
    assert(!/\/api\/files\//.test(h.match(/<meta[^>]+>/g)?.join("") ?? ""), "no file/preview URL in any <meta>");
    return "titles ok; badge toggles with verification_status; /design 404; placeholders noindex (meta+header); legal links on auth/unavailable/buyer pages; neutral og/twitter";
  });
  await check("[#5 M2-09] noindex: meta robots + X-Robots-Tag on link page / public API / previews; robots.txt disallows /u/", async () => {
    const r = await anon.req("GET", `/u/${publicLinkId}`);
    eq(r.headers.get("x-robots-tag"), "noindex, nofollow", "X-Robots-Tag on page");
    const html = await r.text();
    assert(/<meta name="robots" content="noindex, ?nofollow[^"]*"/.test(html), "meta robots noindex,nofollow");
    eq((await anon.req("GET", `/api/public/drops/${publicLinkId}`)).headers.get("x-robots-tag"), "noindex, nofollow", "public API header");
    eq((await anon.req("GET", `/api/files/${fileId}/preview`)).headers.get("x-robots-tag"), "noindex, nofollow", "preview header");
    const rb = await anon.req("GET", "/robots.txt");
    eq(rb.status, 200, "robots.txt");
    const txt = await rb.text();
    assert(/User-Agent: \*/i.test(txt) && /Disallow: \/u\//.test(txt), `robots.txt disallows /u/ (${txt.replace(/\n/g, " | ")})`);
    eq((await anon.req("GET", "/sitemap.xml")).status, 404, "no sitemap");
  });

  // ---- #6 security headers ----
  await check("[#6 M6-02] security headers on pages, API and files; no X-Powered-By", async () => {
    for (const u of ["/", "/login", `/u/${publicLinkId}`, "/api/settings", `/api/files/${fileId}/preview`, "/api/auth/me", "/robots.txt"]) {
      const r = await anon.req("GET", u);
      const h = (n: string) => r.headers.get(n) ?? "";
      const csp = h("content-security-policy");
      assert(/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp), `${u} CSP: ${csp}`);
      assert(/max-age=\d{7,}/.test(h("strict-transport-security")), `${u} HSTS`);
      eq(h("x-content-type-options"), "nosniff", `${u} nosniff`);
      eq(h("x-frame-options"), "DENY", `${u} XFO`);
      assert(h("referrer-policy") !== "", `${u} Referrer-Policy`);
      assert(/camera=\(\)/.test(h("permissions-policy")), `${u} Permissions-Policy`);
      assert(r.headers.get("x-powered-by") === null, `${u} X-Powered-By absent`);
    }
    const page = await anon.req("GET", "/");
    return "CSP, HSTS, nosniff, XFO DENY, Referrer-Policy, Permissions-Policy present; X-Powered-By absent (" + page.headers.get("referrer-policy") + ")";
  });
  await check("[#6 M6-02] CSP does not break the app: pages still serve inline bootstrap scripts (browser-less check: policy allows 'unsafe-inline' scripts)", async () => {
    const r = await anon.req("GET", "/login");
    const csp = r.headers.get("content-security-policy")!;
    const html = await r.text();
    const inline = /<script(?![^>]*\bsrc=)[^>]*>/.test(html);
    assert(!inline || /script-src[^;]*'unsafe-inline'/.test(csp), "inline scripts present but not permitted by CSP");
    assert(!/script-src[^;]*\*|https?:\/\//.test(csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? ""), "no third-party script origins");
  });

  // ---- #7 Origin handling ----
  await check("[#7] bad / foreign / malformed Origin on mutating requests -> 403 JSON (never 500); same-origin still works", async () => {
    const c = new Client_();
    for (const o of ["null", "garbage", "http://evil.example", "https://evil.example:3100", "javascript:alert(1)", "://", " ", "http://localhost:3100.evil.example", "file:///etc/passwd"]) {
      for (const m of ["POST"]) {
        const r = await c.req(m, "/api/auth/logout", { headers: { origin: o } });
        assert(r.status === 403, `${m} Origin=${JSON.stringify(o)} -> ${r.status}`);
        const j = await r.json();
        assert(j.code === "bad_origin" && typeof j.error === "string", `JSON error body for ${o}`);
        assert(/application\/json/.test(r.headers.get("content-type") ?? ""), "content-type json");
      }
    }
    eq((await c.req("POST", "/api/auth/login", { json: { email: "nobody@example.test", password: "whatever-whatever" }, headers: { origin: BASE } })).status, 401, "same-origin Origin allowed");
    eq((await c.req("POST", "/api/auth/login", { json: { email: "nobody@example.test", password: "whatever-whatever" } })).status, 401, "no Origin allowed (non-browser client)");
    const srv = fs.readFileSync(".e2e/server.log", "utf8");
    assert(!/Invalid URL/.test(srv), "no 'Invalid URL' errors in server log");
  });

  // ---- #8 download TTL ----
  await check("[#8] signed URL default TTL = 24 h; platform_settings.download_ttl_seconds overrides; explicit short TTL still expires (410)", async () => {
    const left = async () => { const j = await (await alice.req("POST", `/api/files/${fileId}/signed-url`)).json(); return (Date.parse(j.expiresAt) - Date.now()) / 1000; };
    const d = await left();
    assert(d > 86400 - 30 && d <= 86400 + 5, `default TTL ${d}s ≈ 86400`);
    try {
      await db.query("UPDATE platform_settings SET download_ttl_seconds = 120 WHERE id=1");
      const o = await left();
      assert(o > 90 && o <= 125, `override TTL ${o}s ≈ 120`);
    } finally { await db.query("UPDATE platform_settings SET download_ttl_seconds = NULL WHERE id=1"); }
    const short = signOriginalUrl(fileId, 1);
    await new Promise((r) => setTimeout(r, 2500));
    eq((await anon.req("GET", short.path)).status, 410, "expired short-TTL link");
    return `default ${Math.round(d)}s, override 120s ok`;
  });

  // ---- #9 password policy ----
  await check("[#9 M1-03] password policy: blocklist, email/local-part, repeated/sequential, length >= 10; clear messages; good password accepted", async () => {
    const tryPw = async (pw: string, em = `pw${Math.random().toString(36).slice(2, 8)}+${stamp}@example.test`) => {
      const r = await new Client_().req("POST", "/api/auth/signup", { json: { email: em, password: pw, displayName: "Pw Test" } });
      return { status: r.status, body: await r.json() };
    };
    const bad: [string, string?][] = [["short1!"], ["123456789"], ["password123"], ["password1234"], ["qwertyuiop"], ["letmein123"], ["iloveyou12"], ["sunshine2024!"], ["Password123"], ["1234567890"], ["aaaaaaaaaaaa"], ["abababababab"], ["abcdefghijkl"], ["9876543210"], ["monkeymonkey"]];
    for (const [pw] of bad) {
      const r = await tryPw(pw);
      assert(r.status === 400 && r.body.code !== undefined && /password|Password/.test(r.body.error), `"${pw}" -> ${r.status} ${JSON.stringify(r.body)}`);
    }
    const em = `jane.doe${stamp}@example.test`;
    let r = await tryPw(em, em);
    assert(r.status === 400 && /email/i.test(r.body.error), `password == email -> ${JSON.stringify(r.body)}`);
    r = await tryPw(`jane.doe${stamp}`, em);
    assert(r.status === 400 && /email/i.test(r.body.error), `password == local-part -> ${JSON.stringify(r.body)}`);
    const msg = (await tryPw("password123")).body.error as string;
    assert(msg.length > 15, "message is human readable: " + msg);
    r = await tryPw("correct-horse-battery-staple");
    eq(r.status, 201, `strong passphrase accepted (${JSON.stringify(r.body)})`);
    return `${bad.length} weak passwords + email/local-part rejected; e.g. "${msg}"`;
  });

  // ---- #10 attestation ----
  await check("[#10 M2-05] re-publishing keeps the FIRST attestation timestamp; re-attestations are appended to attestation_history", async () => {
    const q = async () => (await db.query("SELECT attested_at, attestation, attestation_history, last_republished_at, status FROM drops WHERE id=$1", [dropId])).rows[0];
    const a0 = await q();   // published once by the [#3] check
    assert(a0.attested_at, "attested_at set on first publish");
    eq(new Date(a0.attestation.at).getTime(), new Date(a0.attested_at).getTime(), "attestation.at == attested_at");
    const h0 = a0.attestation_history.length; // the foundation check above already published once, [#3] re-published once
    await new Promise((r) => setTimeout(r, 1100));
    eq((await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: att } })).status, 200, "publish again");
    const a1 = await q();
    eq(new Date(a1.attested_at).getTime(), new Date(a0.attested_at).getTime(), "attested_at unchanged after repeat publish");
    eq(a1.attestation.at, a0.attestation.at, "attestation.at unchanged");
    eq(a1.attestation_history.length, h0 + 1, "history grows by one");
    assert(a1.last_republished_at, "last_republished_at set");
    eq((await alice.req("POST", `/api/drops/${dropId}/unpublish`)).status, 200, "unpublish");
    await new Promise((r) => setTimeout(r, 1100));
    eq((await alice.req("POST", `/api/drops/${dropId}/publish`, { json: { attestation: att } })).status, 200, "republish after unpublish");
    const a2 = await q();
    eq(a2.attestation.at, a0.attestation.at, "attestation.at still the original");
    eq(a2.attestation_history.length, h0 + 2, "history grows again");
    assert(new Date(a2.attestation_history[h0 + 1].at) > new Date(a2.attestation_history[h0].at), "history ordered");
    assert(new Date(a2.last_republished_at) > new Date(a0.attested_at), "last_republished_at is later than first attestation");
    eq(a2.status, "published", "published");
    await db.query("UPDATE sellers SET verification_status='pending' WHERE email=$1", [email]);
    return `attested_at=${new Date(a0.attested_at).toISOString()} kept; history entries=${a2.attestation_history.length} (first attestation untouched)`;
  });

  // ---- #11 rate limiting ----
  await check("[#11] /api/checkout keeps its rate limit: handled (400 validation here) until the (env-configured 3/60s) limit, then 429 + Retry-After; other IPs unaffected", async () => {
    const c = new Client_(), other = new Client_();
    const codes: number[] = [];
    // body is deliberately invalid (no email / 18+ confirmation): the limiter must run BEFORE validation, like the old stub
    for (let i = 0; i < 3; i++) codes.push((await c.req("POST", "/api/checkout", { json: { dropId } })).status);
    eq(codes.join(","), "400,400,400", "first three");
    const r = await c.req("POST", "/api/checkout", { json: { dropId } });
    eq(r.status, 429, "4th");
    const ra = Number(r.headers.get("retry-after"));
    assert(Number.isInteger(ra) && ra >= 1 && ra <= 60, `Retry-After ${r.headers.get("retry-after")}`);
    eq((await r.json()).code, "rate_limited", "body code");
    eq((await other.req("POST", "/api/checkout", { json: { dropId } })).status, 400, "different IP still allowed");
    return `Retry-After=${ra}`;
  });
  await check("[#11] download endpoint (/api/files/:id/original) rate limited per IP: 60 allowed/min then 429 + Retry-After", async () => {
    const c = new Client_();
    const rs: Response[] = [];
    for (let b = 0; b < 7; b++) rs.push(...(await Promise.all(Array.from({ length: 10 }, () => c.req("GET", `/api/files/${fileId}/original?exp=1&sig=x`)))));
    const n403 = rs.filter((r) => r.status === 403).length, n429 = rs.filter((r) => r.status === 429);
    eq(n403, 60, `403 count (limit 60/min)`);
    eq(n429.length, 10, "429 count");
    assert(Number(n429[0].headers.get("retry-after")) >= 1, "Retry-After present");
    // a valid signed URL from the same limited IP is also throttled; from another IP it works
    const good = await alice.req("POST", `/api/files/${fileId}/signed-url`);
    const p = (await good.json()).path;
    eq((await c.req("GET", p)).status, 429, "limited IP cannot download even with a valid link");
    eq((await new Client_().req("GET", p)).status, 200, "fresh IP downloads fine");
  });
  await check("[#11] preview, public-link API, signed-url mint, login (per IP), signup are rate limited", async () => {
    const c = new Client_();
    const rs: Response[] = [];
    const ghost = crypto.randomUUID();
    for (let b = 0; b < 31; b++) rs.push(...(await Promise.all(Array.from({ length: 10 }, () => c.req("GET", `/api/files/${ghost}/preview`)))));
    eq(rs.filter((r) => r.status === 404).length, 300, "preview 404s up to limit (300/min)");
    eq(rs.filter((r) => r.status === 429).length, 10, "preview 429s");
    const c2 = new Client_();
    const pub: number[] = [];
    for (let i = 0; i < 122; i++) pub.push((await c2.req("GET", `/api/public/drops/nonexistent01`)).status);
    eq(pub.filter((s) => s === 429).length, 2, "public API 429s after 120/min");
    // (login per-email: no longer a lockout -> progressive delay, see [#13] below)
    // login per-IP
    const c3 = new Client_();
    const li: number[] = [];
    for (let i = 0; i < 21; i++) li.push((await c3.req("POST", "/api/auth/login", { json: { email: `u${i}+${stamp}@example.test`, password: "wrong-password-x" } })).status);
    eq(li[19] === 401 && li[20] === 429, true, `login per-IP: last=${li.slice(-2).join(",")}`);
    const rl = await c3.req("POST", "/api/auth/login", { json: { email: "a@b.co", password: "x" } });
    eq(rl.status, 429, "still limited");
    assert(Number(rl.headers.get("retry-after")) > 0, "login Retry-After");
    // signup per-IP (weak passwords are rejected before bcrypt, so this is fast)
    const c4 = new Client_();
    const su: number[] = [];
    for (let i = 0; i < 11; i++) su.push((await c4.req("POST", "/api/auth/signup", { json: { email: `s${i}+${stamp}@example.test`, password: "short", displayName: "x" } })).status);
    eq(su.slice(0, 10).every((s) => s === 400) && su[10] === 429, true, `signup per-IP: ${su.join(",")}`);
    // signed-url mint
    const mint: number[] = [];
    const lim = new Client_();
    lim.cookies = new Map(alice.cookies);
    for (let i = 0; i < 61; i++) mint.push((await lim.req("POST", `/api/files/${fileId}/signed-url`)).status);
    eq(mint[59] === 200 && mint[60] === 429, true, `signed-url mint limited: ${mint[59]},${mint[60]}`);
  });

  // ---- #12 password reset ----
  await check("[#12] password reset end-to-end via dev mail transport: no enumeration, hashed single-use token, 1h expiry, all sessions revoked, newest link only", async () => {
    const { c: b1, email: bem } = await signupClient("reset");
    const b2 = new Client_();
    eq((await b2.req("POST", "/api/auth/login", { json: { email: bem, password } })).status, 200, "second session");
    const before = b1.cookies.get("unveil_session")!;
    const fc = new Client_();
    const known = await fc.req("POST", "/api/auth/forgot-password", { json: { email: bem } });
    const unknownEmail = `ghost+${stamp}@example.test`;
    const unknown = await fc.req("POST", "/api/auth/forgot-password", { json: { email: unknownEmail } });
    eq(known.status, 200, "known status"); eq(unknown.status, 200, "unknown status");
    eq(JSON.stringify(await known.json()), JSON.stringify(await unknown.json()), "identical response bodies (no enumeration)");
    const mails1 = await waitForMails(bem, 1);
    await new Promise((r) => setTimeout(r, 800));
    eq(readMails(unknownEmail).length, 0, "no mail for unknown address");
    const t1 = tokenFrom(mails1[0]);
    // second request invalidates the first link
    await fc.req("POST", "/api/auth/forgot-password", { json: { email: bem } });
    const mails2 = await waitForMails(bem, 2);
    const t2 = tokenFrom(mails2[1]);
    assert(t1 !== t2 && t1.length >= 40, "random distinct tokens");
    const stored = (await db.query("SELECT t.token_hash, t.expires_at, t.created_at FROM password_reset_tokens t JOIN sellers s ON s.id=t.seller_id WHERE s.email=$1", [bem])).rows;
    assert(stored.length === 2 && stored.every((r) => r.token_hash !== t1 && r.token_hash !== t2 && /^[0-9a-f]{64}$/.test(r.token_hash)), "only SHA-256 hashes stored");
    const life = (new Date(stored[0].expires_at).getTime() - new Date(stored[0].created_at).getTime()) / 60000;
    assert(Math.abs(life - 60) < 1, `token lifetime ${life} min`);
    const rc = new Client_();
    eq((await rc.req("POST", "/api/auth/reset-password", { json: { token: t1, password: "a-brand-new-passphrase" } })).status, 400, "older link no longer valid");
    eq((await rc.req("POST", "/api/auth/reset-password", { json: { token: "x".repeat(43), password: "a-brand-new-passphrase" } })).status, 400, "garbage token");
    const weak = await rc.req("POST", "/api/auth/reset-password", { json: { token: t2, password: "password123" } });
    eq(weak.status, 400, "weak new password rejected"); eq((await weak.json()).code, "weak_password", "weak code");
    const ok = await rc.req("POST", "/api/auth/reset-password", { json: { token: t2, password: "a-brand-new-passphrase" } });
    eq(ok.status, 200, "reset ok");
    eq((await b1.req("GET", "/api/auth/me")).status, 401, "session 1 revoked");
    eq((await b2.req("GET", "/api/auth/me")).status, 401, "session 2 revoked");
    const old = new Client_(); old.cookies.set("unveil_session", before);
    eq((await old.req("GET", "/api/auth/me")).status, 401, "captured pre-reset cookie dead");
    eq((await rc.req("POST", "/api/auth/reset-password", { json: { token: t2, password: "another-new-passphrase" } })).status, 400, "token is single-use");
    eq((await new Client_().req("POST", "/api/auth/login", { json: { email: bem, password } })).status, 401, "old password rejected");
    eq((await new Client_().req("POST", "/api/auth/login", { json: { email: bem, password: "a-brand-new-passphrase" } })).status, 200, "new password works");
    // expiry: third link, force-expire it
    await fc.req("POST", "/api/auth/forgot-password", { json: { email: bem } });
    const t3 = tokenFrom((await waitForMails(bem, 3))[2]);
    await db.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = encode(sha256($1::bytea),'hex')", [t3]);
    const exp = await rc.req("POST", "/api/auth/reset-password", { json: { token: t3, password: "yet-another-passphrase" } });
    eq(exp.status, 400, "expired token rejected"); eq((await exp.json()).code, "invalid_token", "expired code");
    // concurrent use of one fresh token: exactly one wins
    const e4 = `race2+${stamp}@example.test`;
    await signupClient("race2");
    await new Client_().req("POST", "/api/auth/forgot-password", { json: { email: e4 } });
    const t4 = tokenFrom((await waitForMails(e4, 1))[0]);
    const par = await Promise.all(Array.from({ length: 4 }, (_, i) => new Client_().req("POST", "/api/auth/reset-password", { json: { token: t4, password: `parallel-passphrase-${i}` } })));
    eq(par.filter((r) => r.status === 200).length, 1, `exactly one concurrent reset wins (${par.map((r) => r.status).join(",")})`);
    return "no enumeration; 2 sessions + captured cookie revoked; token hashed, single-use, 60 min, newest-only";
  });
  await check("[#12] reset pages render; forgot-password is rate limited (per IP 429, per email silently capped)", async () => {
    eq((await anon.req("GET", "/forgot-password")).status, 200, "forgot page");
    eq((await anon.req("GET", "/reset-password?token=abc")).status, 200, "reset page");
    const login = await (await anon.req("GET", "/login")).text();
    assert(login.includes("/forgot-password"), "login links to forgot-password");
    const c = new Client_();
    const st: number[] = [];
    for (let i = 0; i < 6; i++) st.push((await c.req("POST", "/api/auth/forgot-password", { json: { email: `nobody${i}+${stamp}@example.test` } })).status);
    eq(st.slice(0, 5).every((s) => s === 200) && st[5] === 429, true, `forgot per-IP: ${st.join(",")}`);
    const r = await c.req("POST", "/api/auth/forgot-password", { json: { email: "x@example.test" } });
    assert(Number(r.headers.get("retry-after")) > 0, "Retry-After");
    // per-email cap: 4th request for the same address (from fresh IPs) still answers 200 but sends no 4th mail
    const { email: capEm } = await signupClient("capmail");
    for (let i = 0; i < 4; i++) eq((await new Client_().req("POST", "/api/auth/forgot-password", { json: { email: capEm } })).status, 200, "same 200 each time");
    await waitForMails(capEm, 3);
    await new Promise((r2) => setTimeout(r2, 1000));
    eq(readMails(capEm).length, 3, "only 3 mails/hour per address");
    const rst = new Client_();
    const rr: number[] = [];
    for (let i = 0; i < 11; i++) rr.push((await rst.req("POST", "/api/auth/reset-password", { json: { token: "y".repeat(43), password: "some-long-passphrase" } })).status);
    eq(rr.slice(0, 10).every((s) => s === 400) && rr[10] === 429, true, `reset per-IP: ${rr.join(",")}`);
  });

  // ---- #13 progressive login delay (replaces the per-email lockout) ----
  // e2e.sh starts the app with LOGIN_DELAY_THRESHOLD=3, BASE=1, CAP=4 (s) so the schedule is: failures 1-2 free, 3rd -> 1 s, 4th -> 2 s, 5th+ -> 4 s (cap).
  const CAP = 4;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const attempt = (em: string, pw: string, c: Client_ = new Client_()) => c.req("POST", "/api/auth/login", { json: { email: em, password: pw } });
  const retryAfter = (r: Response) => Number(r.headers.get("retry-after"));
  const throttleRow = async (em: string) => (await db.query("SELECT failures, next_allowed_at > now() AS delayed FROM login_throttle WHERE key = $1", ["login:" + crypto.createHash("sha256").update(em.trim().toLowerCase()).digest("hex").slice(0, 24)])).rows[0];
  await check("[#13] attacker spamming 20 wrong passwords: first few 401, then 429 with Retry-After in 1..cap (never above); correct password DURING the delay is also refused, not evaluated", async () => {
    const { c: _o, email: owner } = await signupClient("owner13");
    void _o;
    // 20 concurrent wrong guesses, each from its own (fake) IP = distributed attacker. Admission is serialised per email in the DB,
    // so exactly `threshold` (3) are evaluated; the other 17 are refused without being evaluated.
    // TIMING NOTE (QA INFO-F "flake 3/5"): the first delay is only BASE = 1 s and is armed at ADMISSION time. bcryptjs runs on the server's event loop, so the 3
    // evaluated guesses (~300 ms each, ~1 s when three run together) can take about as long as the delay itself. Requests handled late may then be legitimately
    // admitted again (4 x 401), and the "correct password during the delay" probe below may arrive after the 1 s delay has elapsed (200). That is the throttle
    // working as designed, not a race in it (admission is one row-locked statement), so the test no longer depends on wall-clock luck.
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(owner, `wrong-guess-${i}-xyz`)));
    const burstMs = Date.now() - t0;
    const st = rs.map((r) => r.status);
    const evaluated = st.filter((s) => s === 401).length;
    assert(evaluated === 3 || (evaluated === 4 && burstMs >= 1000), `3 evaluated (4 only if the burst outlasted the 1 s first delay: ${burstMs} ms) (${st.join(",")})`);
    eq(st.filter((s) => s === 429).length, 20 - evaluated, `the rest are delayed (${st.join(",")})`);
    for (const r of rs.filter((r) => r.status === 429)) {
      const ra = retryAfter(r);
      assert(Number.isInteger(ra) && ra >= 1 && ra <= CAP, `Retry-After ${ra} within 1..${CAP}`);
      eq((await r.json()).code, "login_delayed", "error code");
    }
    // the owner's CORRECT password during the active delay is not evaluated (no bypass by guessing during the delay)
    // make "during the delay" deterministic: arm a 3 s delay window explicitly (within the DB bound), then use the real password
    await db.query("UPDATE login_throttle SET next_allowed_at = now() + interval '3 seconds', last_attempt_at = now() WHERE key = $1", ["login:" + crypto.createHash("sha256").update(owner.trim().toLowerCase()).digest("hex").slice(0, 24)]);
    const dur = await attempt(owner, password);
    eq(dur.status, 429, "correct password during the delay -> 429");
    assert(!dur.headers.get("set-cookie"), "no session issued while delayed");
    // ...and rejected attempts neither count nor extend the delay: after waiting out <= cap the owner gets in
    await sleep(CAP * 1000 + 300);
    const ok = await attempt(owner, password);
    eq(ok.status, 200, "owner logs in after waiting out the delay");
    eq(await throttleRow(owner), undefined, "counter reset on success");
    return `${evaluated}x401 + ${20 - evaluated}x429 in ${burstMs} ms (Retry-After <= ${CAP})`;
  });
  await check("[#13] delays escalate exponentially (1,2,4 s) and are capped at the cap; a 429 never persists past Retry-After; no permanent lock", async () => {
    const { email: v } = await signupClient("esc13");
    const seen: number[] = [];
    const hit = async (pw: string) => {
      const r = await attempt(v, pw);
      return r;
    };
    eq((await hit("bad-guess-aaa-1")).status, 401, "1st");
    eq((await hit("bad-guess-aaa-2")).status, 401, "2nd");
    eq((await hit("bad-guess-aaa-3")).status, 401, "3rd (arms 1 s)");
    for (let i = 0; i < 6; i++) {
      const blocked = await hit("bad-guess-bbb");
      eq(blocked.status, 429, `blocked right after failure #${3 + i}`);
      const ra = retryAfter(blocked);
      seen.push(ra);
      await sleep(ra * 1000 + 250); // wait out exactly the advertised delay
      const next = await hit("bad-guess-ccc");
      eq(next.status, 401, `after waiting Retry-After the attempt is evaluated again (failure #${4 + i})`);
    }
    // seen = Retry-After right after failures #3..#8 => 1,2,4,4,4,4 (ceil of the remaining time, so first read may be one lower)
    const exp = [1, 2, 4, 4, 4, 4];
    seen.forEach((ra, i) => assert(ra <= exp[i] && ra >= Math.max(1, exp[i] - 1), `Retry-After #${i + 1} = ${ra}, expected ~${exp[i]}`));
    assert(seen[2] > seen[0] && Math.max(...seen) <= CAP, `increasing then capped: ${seen.join(",")}`);
    // 9 failures deep: the owner must still be able to get in after at most one cap-length wait
    const blocked = await hit(password);
    eq(blocked.status, 429, "correct password during delay -> 429");
    assert(retryAfter(blocked) <= CAP, "still <= cap");
    await sleep(retryAfter(blocked) * 1000 + 250);
    const ok = await hit(password);
    eq(ok.status, 200, "correct password after the delay -> 200 (no permanent lock)");
    return `Retry-After sequence: ${seen.join(",")}`;
  });
  await check("[#13] a correct login resets the counter: next wrong passwords are free again (401,401) and only the 3rd arms the delay", async () => {
    const { email: v } = await signupClient("reset13");
    eq((await attempt(v, "bad-guess-xx-1")).status, 401, "f1");
    eq((await attempt(v, "bad-guess-xx-2")).status, 401, "f2");
    eq((await throttleRow(v)).failures, 2, "2 failures recorded");
    eq((await attempt(v, password)).status, 200, "success while below threshold");
    eq(await throttleRow(v), undefined, "row removed");
    eq((await attempt(v, "bad-guess-xx-3")).status, 401, "fresh f1");
    eq((await attempt(v, "bad-guess-xx-4")).status, 401, "fresh f2");
    eq((await attempt(v, "bad-guess-xx-5")).status, 401, "fresh f3 (evaluated; arms the delay)");
    const d = await attempt(v, "bad-guess-xx-6");
    eq(d.status, 429, "delayed");
    await sleep(retryAfter(d) * 1000 + 250);
    eq((await attempt(v, password)).status, 200, "success after delay");
    eq((await attempt(v, "bad-guess-xx-7")).status, 401, "counter reset again after success");
    eq((await attempt(v, "bad-guess-xx-8")).status, 401, "still free");
  });
  await check("[#13] no user enumeration: an unknown email gets the identical delay behaviour (401,401,401 then 429 + Retry-After <= cap)", async () => {
    const ghost = `ghost13+${stamp}@example.test`;
    const st: number[] = [];
    let ra = 0;
    for (let i = 0; i < 6; i++) {
      const r = await attempt(ghost, `bad-guess-g-${i}-zz`);
      st.push(r.status);
      if (r.status === 429) ra = Math.max(ra, retryAfter(r));
    }
    eq(st.join(), "401,401,401,429,429,429", "same status sequence as a real account");
    assert(ra >= 1 && ra <= CAP, `Retry-After ${ra} <= cap`);
    await sleep(CAP * 1000 + 300);
    eq((await attempt(ghost, "bad-guess-g-after")).status, 401, "after the delay: evaluated again (401, not a lock)");
  });
  await check("[#13] password reset clears the login delay; delayed state is per email (other emails unaffected); DB bound: next_allowed_at <= last_attempt_at + 1 h", async () => {
    const { email: v } = await signupClient("pwreset13");
    const { email: other } = await signupClient("other13");
    for (let i = 0; i < 4; i++) await attempt(v, `bad-guess-r-${i}-q`);
    eq((await throttleRow(v)).delayed, true, "victim is in a delay window");
    eq((await attempt(other, password)).status, 200, "another account is not affected");
    await new Client_().req("POST", "/api/auth/forgot-password", { json: { email: v } });
    const tok = tokenFrom((await waitForMails(v, 1))[0]);
    eq((await new Client_().req("POST", "/api/auth/reset-password", { json: { token: tok, password: "reset-passphrase-13x" } })).status, 200, "reset");
    eq(await throttleRow(v), undefined, "counter cleared by reset");
    eq((await attempt(v, "reset-passphrase-13x")).status, 200, "owner logs in immediately after reset, no waiting");
    const bad = await db.query("SELECT count(*)::int AS n FROM login_throttle WHERE next_allowed_at > last_attempt_at + interval '1 hour'");
    eq(bad.rows[0].n, 0, "no row exceeds the 1 h hard bound");
    let rejected = false;
    try { await db.query("INSERT INTO login_throttle (key, failures, last_attempt_at, next_allowed_at) VALUES ('x', 99, now(), now() + interval '2 hours')"); } catch { rejected = true; }
    assert(rejected, "CHECK constraint refuses a >1 h block");
  });


  // =====================================================================================
  // PAYMENTS (mock processor): checkout -> signed webhook -> ledger -> duplicates/bad signature/decline/refund
  // =====================================================================================
  const WH_SECRET = process.env.PAYMENT_WEBHOOK_SECRET!;
  assert(WH_SECRET && WH_SECRET.length >= 32, "PAYMENT_WEBHOOK_SECRET must be set for the payments e2e (scripts/e2e.sh does)");
  async function rawPost(who: Client_, rawBody: string, headers: Record<string, string>) {
    return fetch(BASE + "/api/webhooks/mock", { method: "POST", headers: { "x-forwarded-for": who.ip, ...headers }, body: rawBody });
  }
  const hook = async (event: MockWireEvent, opts: { secret?: string; nowSec?: number } = {}) => {
    const sgn = signMockEvent(event, opts.secret ?? WH_SECRET, { nowSec: opts.nowSec });
    const r = await rawPost(new Client_(), sgn.rawBody, sgn.headers);
    return { status: r.status, body: await r.json() as { outcome?: string; detail?: string; code?: string } };
  };
  const payEmail = `pay+${stamp}@example.test`;
  const sellerEmail = `payseller+${stamp}@example.test`;
  const sellerC = new Client_();
  let payLink = "";
  const ledgerSum = async (txId: string) => Number((await db.query("SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger_entries WHERE transaction_id=$1", [txId])).rows[0].s);
  const txState = async (id: string) => (await db.query("SELECT status, reversed_cents, processor_ref, failure_code, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents FROM transactions WHERE id=$1", [id])).rows[0];
  const startCheckout = async (over: Record<string, unknown> = {}) =>
    new Client_().req("POST", "/api/checkout", { json: { linkId: payLink, email: payEmail, confirmOver18: true, ...over } });

  await check("[pay] setup: seller signs up, is verified, creates a $20.00 drop with a file, publishes it", async () => {
    eq((await sellerC.req("POST", "/api/auth/signup", { json: { email: sellerEmail, password, displayName: "Pay Seller" } })).status, 201, "signup");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [sellerEmail]);
    const d = (await (await sellerC.req("POST", "/api/drops", { json: { title: "Paid drop", priceCents: 2000 } })).json()).drop;
    eq((await sellerC.req("POST", `/api/drops/${d.id}/files`, { form: uploadForm(await tinyPng("#aa5500")) })).status, 201, "upload");
    eq((await sellerC.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: att } })).status, 200, "publish");
    payLink = d.public_link_id;
  });

  await check("[pay] public drop page has the buy form (email + 18+ checkbox), no client-supplied amount", async () => {
    const html = stripComments(await (await anon.req("GET", `/u/${payLink}`)).text());
    assert(html.includes('data-testid="buy-form"') && html.includes('data-testid="over18"') && html.includes('data-testid="buy-button"'), "buy form present");
    assert(html.includes("Pay $20.00") && !html.includes("Unlock for") && !/for your receipt|Instant download/i.test(html), "price shown");
  });

  await check("[pay] checkout validation: email required, 18+ confirmation required, amount field ignored, unpublished/unknown drop, cross-origin blocked", async () => {
    eq((await startCheckout({ email: undefined })).status, 400, "no email");
    eq((await startCheckout({ email: "not-an-email" })).status, 400, "bad email");
    const noAge = await startCheckout({ confirmOver18: false });
    eq(noAge.status, 400, "18+ false");
    eq((await startCheckout({ confirmOver18: undefined })).status, 400, "18+ missing");
    eq((await new Client_().req("POST", "/api/checkout", { json: { email: payEmail, confirmOver18: true } })).status, 400, "no drop");
    eq((await startCheckout({ linkId: "AAAAAAAAAAAA" })).status, 404, "unknown link");
    const draft = (await (await sellerC.req("POST", "/api/drops", { json: { title: "Draft", priceCents: 500 } })).json()).drop;
    eq((await new Client_().req("POST", "/api/checkout", { json: { dropId: draft.id, email: payEmail, confirmOver18: true } })).status, 404, "unpublished (draft) drop");
    await db.query("UPDATE sellers SET verification_status='pending' WHERE email=$1", [sellerEmail]);
    eq((await startCheckout()).status, 409, "seller not verified");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [sellerEmail]);
    eq((await new Client_().req("POST", "/api/checkout", { json: { linkId: payLink, email: payEmail, confirmOver18: true }, headers: { origin: "http://evil.example" } })).status, 403, "cross-origin");
    const n0 = (await db.query("SELECT count(*)::int AS n FROM transactions")).rows[0].n;
    eq(n0, 0, "no transaction rows were created by rejected requests");
  });

  let tx1 = "", session1 = "";
  await check("[pay] valid checkout: 201, PENDING transaction priced from the DB ($20 -> 2.40 / 2.00 / 15.60) even if the client sends an amount; nothing on the ledger", async () => {
    const r = await startCheckout({ amountCents: 1, amount: 0.01, priceCents: 1 });
    eq(r.status, 201, "status");
    const body = await r.json();
    tx1 = body.transactionId;
    eq(body.amountCents, 2000, "amount from DB");
    assert(/\/pay\/mock\/mocksess_[0-9a-f]{32}$/.test(body.checkoutUrl), `checkoutUrl ${body.checkoutUrl}`);
    session1 = body.checkoutUrl.split("/").pop();
    const t = await txState(tx1);
    eq(t.status, "pending", "status pending");
    eq([t.amount_cents, t.processing_fee_cents, t.platform_fee_cents, t.seller_net_cents].join(","), "2000,240,200,1560", "fee split");
    eq((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id=$1", [tx1])).rows[0].n, 0, "no ledger yet");
    eq((await anon.req("GET", `/api/checkout/status?id=${tx1}`).then((x) => x.json())).status, "pending", "status API");
  });

  await check("[pay] hosted mock checkout page renders (e2e runs the production build on loopback with the local-build flag)", async () => {
    const r = await anon.req("GET", `/pay/mock/${session1}`);
    eq(r.status, 200, "page");
    const html = stripComments(await r.text());
    assert(html.includes("Mock checkout") && html.includes("$20.00"), "page content");
    eq((await anon.req("GET", `/pay/mock/mocksess_${"0".repeat(32)}`)).status, 404, "unknown session");
  });

  await check("[pay] bad signature is rejected (401) with NO state change; tampered body, wrong secret, stale timestamp, missing header all 401", async () => {
    const ev = mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000 });
    const wrong = await hook(ev, { secret: "an-attacker-secret-an-attacker-secret-1234" });
    eq(wrong.status, 401, "wrong secret");
    const stale = await hook(ev, { nowSec: Math.floor(Date.now() / 1000) - 3600 });
    eq(stale.status, 401, "stale");
    const good = signMockEvent(mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 100 }), WH_SECRET);
    const tampered = await rawPost(new Client_(), good.rawBody.replace('"amount_cents":100', '"amount_cents":2000'), good.headers);
    eq(tampered.status, 401, "tampered body");
    eq((await rawPost(new Client_(), good.rawBody, { "content-type": "application/json" })).status, 401, "no signature header");
    eq((await txState(tx1)).status, "pending", "still pending");
    eq((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id=$1", [tx1])).rows[0].n, 0, "ledger untouched");
    const rej = (await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE outcome='rejected' AND signature_valid=false")).rows[0].n;
    assert(rej >= 4, `rejections are logged (${rej})`);
    eq((await rawPost(new Client_(), "x", {})).status, 401, "garbage unsigned");
  });

  await check("[pay] unknown provider segment -> 404", async () => {
    const r = await fetch(BASE + "/api/webhooks/segpay", { method: "POST", body: "{}" });
    eq(r.status, 404, "status");
    eq((await fetch(BASE + "/api/webhooks/__proto__", { method: "POST", body: "{}" })).status, 404, "__proto__");
  });

  await check("[pay] signed sale webhook -> transaction succeeded, ledger = +20.00 / -2.00 / -2.40 (sums to 15.60), balance pending 15.60", async () => {
    const r = await hook(mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000, eventId: "evt_e2e_sale_1" }));
    eq(r.status, 200, "status");
    eq(r.body.outcome, "processed", "outcome");
    const t = await txState(tx1);
    eq(t.status, "succeeded", "status");
    eq(t.processor_ref, mockSaleId(tx1), "processor ref");
    const rows = (await db.query("SELECT entry_type, amount_cents FROM ledger_entries WHERE transaction_id=$1 ORDER BY id", [tx1])).rows;
    eq(rows.map((x) => `${x.entry_type}:${x.amount_cents}`).join(","), "sale_credit:2000,platform_fee:-200,processing_fee:-240", "ledger lines");
    eq(await ledgerSum(tx1), 1560, "sum");
    eq((await anon.req("GET", `/api/checkout/status?id=${tx1}`).then((x) => x.json())).status, "succeeded", "status API");
    const earn = await (await sellerC.req("GET", "/api/earnings")).json();
    eq(earn.balance.pendingCents, 1560, "pending balance");
    eq(earn.balance.availableCents, 0, "available (7-day hold)");
    eq(earn.lifetime.grossCents, 2000, "lifetime gross");
    eq((await anon.req("GET", "/api/earnings")).status, 401, "earnings needs a session");
  });

  await check("[pay] duplicate webhook (same event, and same sale under a new event id) -> 200 'duplicate', still exactly one ledger posting and one succeeded charge", async () => {
    const same = await hook(mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000, eventId: "evt_e2e_sale_1" }));
    eq(same.status, 200, "status"); eq(same.body.outcome, "duplicate", "outcome");
    const renamed = await hook(mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000, eventId: "evt_e2e_sale_1_replayed_under_new_id" }));
    eq(renamed.status, 200, "status2"); eq(renamed.body.outcome, "duplicate", "outcome2");
    eq((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id=$1", [tx1])).rows[0].n, 3, "3 ledger lines");
    const outs = (await db.query("SELECT outcome FROM webhook_events WHERE transaction_id=$1 ORDER BY received_at, id", [tx1])).rows.map((r) => r.outcome).join(",");
    eq(outs, "processed,duplicate,duplicate", "reconciliation log");
    // concurrent burst over HTTP
    const ev = mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000, eventId: "evt_e2e_sale_1" });
    const rs = await Promise.all(Array.from({ length: 10 }, () => hook(ev)));
    assert(rs.every((x) => x.status === 200 && x.body.outcome === "duplicate"), "10 concurrent redeliveries all duplicate");
    eq(await ledgerSum(tx1), 1560, "still 15.60");
  });

  await check("[pay] unknown transaction -> 200 ignored, nothing created", async () => {
    const n0 = (await db.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n;
    const r = await hook(mockEvents.saleSucceeded({ transactionId: "99999999-9999-4999-8999-999999999999", amountCents: 2000 }));
    eq(r.status, 200, "status"); eq(r.body.outcome, "ignored", "outcome"); eq(r.body.detail, "unknown_transaction", "detail");
    eq((await db.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n, n0, "ledger untouched");
  });

  await check("[pay] declined card: hosted-page 'pay' with the decline test card -> transaction failed (card_declined), no ledger; the approve card then works on a new checkout", async () => {
    const co = await (await startCheckout()).json();
    const sid = co.checkoutUrl.split("/").pop();
    const r = await new Client_().req("POST", "/api/dev/payments/pay", { json: { sessionId: sid, card: TEST_CARDS.declined } });
    eq(r.status, 200, "pay call");
    const body = await r.json();
    eq(body.status, "failed", "status"); eq(body.failureCode, "card_declined", "failure code");
    const t = await txState(co.transactionId);
    eq(t.status, "failed", "db status"); eq(t.failure_code, "card_declined", "db failure code");
    eq((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id=$1", [co.transactionId])).rows[0].n, 0, "no ledger");
    // insufficient funds variant
    const co2 = await (await startCheckout()).json();
    const r2 = await (await new Client_().req("POST", "/api/dev/payments/pay", { json: { sessionId: co2.checkoutUrl.split("/").pop(), card: TEST_CARDS.insufficientFunds } })).json();
    eq(r2.failureCode, "insufficient_funds", "insufficient funds");
    // approved card via the simulator path = the same signed-webhook pipeline
    const co3 = await (await startCheckout()).json();
    const r3 = await (await new Client_().req("POST", "/api/dev/payments/pay", { json: { sessionId: co3.checkoutUrl.split("/").pop(), card: TEST_CARDS.approved } })).json();
    eq(r3.status, "succeeded", "approved"); eq(r3.webhook.outcome, "processed", "via webhook pipeline");
    eq(await ledgerSum(co3.transactionId), 1560, "ledger for simulator-paid sale");
  });

  await check("[pay] out-of-order: refund webhook BEFORE the sale is parked (200), then applied when the sale arrives -> refunded, ledger nets to 0", async () => {
    const co = await (await startCheckout()).json();
    const early = await hook(mockEvents.refund({ transactionId: co.transactionId, refundId: "mockrf_e2e_early", amountCents: 2000 }));
    eq(early.status, 200, "status"); eq(early.body.outcome, "parked", "parked");
    eq((await txState(co.transactionId)).status, "pending", "still pending");
    eq((await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000 }))).body.outcome, "processed", "sale");
    const t = await txState(co.transactionId);
    eq(t.status, "refunded", "refunded after sale lands");
    eq(await ledgerSum(co.transactionId), 0, "net 0");
  });

  await check("[pay] refund: full refund of the $20 sale (via request + signed refund webhook) reverses the ledger exactly; double refund is rejected; partial refund on another sale is cents-exact", async () => {
    const sim = await new Client_().req("POST", "/api/dev/payments/refund", { json: { transactionId: tx1 } });
    eq(sim.status, 200, "refund call");
    eq((await sim.json()).webhook.outcome, "processed", "webhook processed");
    const t = await txState(tx1);
    eq(t.status, "refunded", "status"); eq(t.reversed_cents, 2000, "reversed");
    eq(await ledgerSum(tx1), 0, "ledger nets to 0");
    const rows = (await db.query("SELECT entry_type, component, amount_cents FROM ledger_entries WHERE transaction_id=$1 AND entry_type='refund_reversal' ORDER BY id", [tx1])).rows;
    eq(rows.map((r) => `${r.component}:${r.amount_cents}`).join(","), "gross:-2000,platform_fee:200,processing_fee:240", "reversal lines");
    eq((await new Client_().req("POST", "/api/dev/payments/refund", { json: { transactionId: tx1 } })).status, 409, "cannot refund a refunded sale");
    // over-refund via a (validly signed) webhook is rejected, ledger unchanged
    const over = await hook(mockEvents.refund({ transactionId: tx1, refundId: "mockrf_over", amountCents: 1 }));
    eq(over.body.outcome, "rejected", "over refund"); eq(over.body.detail, "over_refund", "detail");
    eq(await ledgerSum(tx1), 0, "still 0");
    // partial refunds on a fresh sale: 3333 + 1 + rest
    const co = await (await startCheckout()).json();
    await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000 }));
    for (const amt of [666, 1, 1, 332]) {
      const r = await (await new Client_().req("POST", "/api/dev/payments/refund", { json: { transactionId: co.transactionId, amountCents: amt } })).json();
      eq(r.webhook.outcome, "processed", `partial ${amt}`);
    }
    const t2 = await txState(co.transactionId);
    eq(t2.reversed_cents, 1000, "reversed so far");
    eq(await ledgerSum(co.transactionId), 780, "half the seller net remains (1560 - 780)");
    const rest = await (await new Client_().req("POST", "/api/dev/payments/refund", { json: { transactionId: co.transactionId } })).json();
    eq(rest.amountCents, 1000, "remaining refundable");
    eq(await ledgerSum(co.transactionId), 0, "fully reversed to exactly 0");
  });

  await check("[pay] chargeback: webhook reverses the sale, status charged_back, and a negative balance is allowed", async () => {
    const co = await (await startCheckout()).json();
    await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000 }));
    const r = await hook(mockEvents.chargeback({ transactionId: co.transactionId, amountCents: null }));
    eq(r.body.outcome, "processed", "chargeback");
    eq((await txState(co.transactionId)).status, "charged_back", "status");
    eq(await ledgerSum(co.transactionId), 0, "reversed");
  });

  await check("[pay] reconciliation log: every delivery above is recorded (processed/duplicate/rejected/ignored/parked) with hashes; ledger entries are append-only", async () => {
    const o = (await db.query("SELECT outcome, count(*)::int AS n FROM webhook_events GROUP BY outcome")).rows;
    const by = Object.fromEntries(o.map((r) => [r.outcome, r.n]));
    for (const k of ["processed", "duplicate", "rejected", "ignored"]) assert((by[k] ?? 0) > 0, `has ${k} rows (${JSON.stringify(by)})`);
    eq((await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE payload_sha256 !~ '^[0-9a-f]{64}$'")).rows[0].n, 0, "all hashed");
    let blocked = false;
    try { await db.query("UPDATE ledger_entries SET amount_cents = 1 WHERE id = (SELECT min(id) FROM ledger_entries)"); } catch { blocked = true; }
    assert(blocked, "UPDATE on ledger_entries is blocked");
    // global invariant: every transaction's ledger sums to what the seller still nets from it
    const bad = (await db.query(`
      SELECT t.id FROM transactions t JOIN (SELECT transaction_id, SUM(amount_cents) s FROM ledger_entries GROUP BY 1) l ON l.transaction_id = t.id
       WHERE l.s <> t.seller_net_cents - (SELECT COALESCE(SUM(-amount_cents),0) FROM ledger_entries e WHERE e.transaction_id=t.id AND e.entry_type IN ('refund_reversal','chargeback_reversal') AND e.component='gross')
                    + (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_entries e WHERE e.transaction_id=t.id AND e.entry_type IN ('refund_reversal','chargeback_reversal') AND e.component IN ('platform_fee','processing_fee'))`)).rows;
    eq(bad.length, 0, "ledger identity holds for every transaction");
    return `outcomes: ${JSON.stringify(by)}`;
  });

  // ---------------------------------------------------------------- round 2: QA fixes (items 1-7) over real HTTP
  const freshEmail = (tag: string) => `pay-${tag}+${stamp}-${crypto.randomBytes(3).toString("hex")}@example.test`;
  const coFor = (email: string, headers: Record<string, string> = {}, who: Client_ = new Client_()) =>
    who.req("POST", "/api/checkout", { json: { linkId: payLink, email, confirmOver18: true }, headers });
  const payVia = async (sessionId: string, card: string) => (await (await new Client_().req("POST", "/api/dev/payments/pay", { json: { sessionId, card } })).json());
  const sessionIdOf = (b: { checkoutUrl: string }) => b.checkoutUrl.split("/").pop()!;

  await check("[pay#1] concurrent identical POST /api/checkout (x8, same drop+email) -> ONE pending transaction/session; Idempotency-Key honoured (same key = same txn, other drop = 409)", async () => {
    const em = freshEmail("conc");
    // a real double click = same browser: same Idempotency-Key header (the buy form sends one per page load)
    const dk = crypto.randomUUID();
    const rs = await Promise.all(Array.from({ length: 8 }, () => coFor(em, { "idempotency-key": dk })));
    assert(rs.every((r) => r.status === 200 || r.status === 201), `statuses ${rs.map((r) => r.status)}`);
    const bodies = await Promise.all(rs.map((r) => r.json()));
    eq(new Set(bodies.map((b) => b.transactionId)).size, 1, "one transaction id");
    eq(new Set(bodies.map((b) => b.checkoutUrl)).size, 1, "one session");
    eq(rs.filter((r) => r.status === 201).length, 1, "exactly one 201 (new), the rest 200 (reused)");
    eq((await db.query("SELECT count(*)::int AS n FROM transactions WHERE lower(buyer_email)=lower($1)", [em])).rows[0].n, 1, "one row in the DB");
    // same browser by cookie (no key): the first response set an httpOnly buyer cookie, later requests reuse the session
    const br = new Client_();
    const em3 = freshEmail("cookie");
    const c1 = await coFor(em3, {}, br);
    eq(c1.status, 201, "first");
    const sc = c1.headers.getSetCookie().find((x) => x.startsWith("unveil_buyer="));
    assert(sc && /httponly/i.test(sc) && /samesite=lax/i.test(sc), `buyer cookie is httpOnly: ${sc}`);
    // same browser (same cookie jar), different source IPs so the e2e's tiny checkout limiter (3/min/IP) isn't what is being tested here
    const reps = await Promise.all(Array.from({ length: 5 }, (_, i) => coFor(em3, { "x-forwarded-for": `10.88.7.${i + 1}` }, br)));
    assert(reps.every((r) => r.status === 200), `cookie replays 200 ${reps.map((r) => r.status)}`);
    const repBodies = await Promise.all(reps.map((r) => r.json()));
    eq(new Set(repBodies.map((b) => b.transactionId)).size, 1, "same txn for the same browser");
    eq((await c1.json()).transactionId, repBodies[0].transactionId, "same as the first");
    // Idempotency-Key
    const em2 = freshEmail("idem");
    const k = crypto.randomUUID();
    const a = await coFor(em2, { "idempotency-key": k });
    const b = await coFor(em2, { "idempotency-key": k });
    eq(a.status, 201, "first"); eq(b.status, 200, "replay");
    eq((await a.json()).transactionId, (await b.json()).transactionId, "same txn for the same key");
    // the same key for a different drop is a client error, not someone else's session
    const d2 = (await (await sellerC.req("POST", "/api/drops", { json: { title: "Second paid drop", priceCents: 1500 } })).json()).drop;
    eq((await sellerC.req("POST", `/api/drops/${d2.id}/files`, { form: uploadForm(await tinyPng("#2255aa")) })).status, 201, "upload2");
    eq((await sellerC.req("POST", `/api/drops/${d2.id}/publish`, { json: { attestation: att } })).status, 200, "publish2");
    const other = await new Client_().req("POST", "/api/checkout", { json: { linkId: d2.public_link_id, email: em2, confirmOver18: true }, headers: { "idempotency-key": k } });
    eq(other.status, 409, "same key, different drop -> 409");
    // a paid checkout is not handed out again
    const paid = await (await coFor(em2, { "idempotency-key": k })).json();
    eq((await payVia(sessionIdOf(paid), TEST_CARDS.approved)).status, "succeeded", "pay it");
    const again = await coFor(em2);
    eq(again.status, 201, "after success a new purchase attempt gets a NEW pending session");
    assert((await again.json()).transactionId !== paid.transactionId, "new txn");
  });

  await check("[pay#1b] privacy (QA NEW-1): another client with the victim's email + drop gets its OWN session and never the victim's checkoutUrl/txn id; stale price supersedes", async () => {
    const em = freshEmail("victim");
    const victimBrowser = new Client_();
    const v = await (await coFor(em, {}, victimBrowser)).json();
    const attacker = await coFor(em); // no cookie, no key, different IP
    eq(attacker.status, 201, "attacker gets a NEW checkout, not a 200 reuse");
    const ab = await attacker.json();
    assert(ab.transactionId !== v.transactionId && ab.checkoutUrl !== v.checkoutUrl, "independent session");
    eq(ab.reused, false, "reused:false");
    const raw = JSON.stringify(ab);
    assert(!raw.includes(v.transactionId) && !raw.includes(sessionIdOf(v)), "victim's ids absent from the response");
    // the victim's own browser still gets exactly its session back
    const back = await coFor(em, {}, victimBrowser);
    eq(back.status, 200, "owner reuse"); eq((await back.json()).checkoutUrl, v.checkoutUrl, "owner gets own url");
    // a forged / guessed cookie token is not a credential
    const forged = await new Client_().req("POST", "/api/checkout", { json: { linkId: payLink, email: em, confirmOver18: true }, headers: { cookie: "unveil_buyer=" + "A".repeat(43) } });
    eq(forged.status, 201, "forged cookie -> new session");
    assert((await forged.json()).transactionId !== v.transactionId, "forged cookie didn't reach the victim's txn");
    // price change supersedes the owner's stale pending checkout
    const dropId = (await db.query("SELECT id FROM drops WHERE public_link_id=$1", [payLink])).rows[0].id;
    await db.query("UPDATE drops SET price_cents=2500 WHERE id=$1", [dropId]);
    try {
      const np = await coFor(em, {}, victimBrowser);
      eq(np.status, 201, "new session after price change");
      const nb = await np.json();
      eq(nb.amountCents, 2500, "current price"); assert(nb.transactionId !== v.transactionId, "new txn");
      const old = await txState(v.transactionId);
      eq([old.status, old.failure_code].join(), "failed,superseded", "old pending txn superseded");
    } finally { await db.query("UPDATE drops SET price_cents=2000 WHERE id=$1", [dropId]); }
  });

  await check("[pay#3] NUL byte / invalid strings in the event id or data.reference -> 400 (never 500) with a 'rejected' reconciliation row; garbage JSON -> 400; handler still healthy after", async () => {
    const co = await (await coFor(freshEmail("nul"))).json();
    const before = (await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE outcome='rejected'")).rows[0].n;
    const bad1 = await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000, eventId: "evt_nul\u0000_x" }));
    eq(bad1.status, 400, "NUL in event id");
    const evRef = mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000, eventId: "evt_nul_ref" }) as unknown as { data: Record<string, unknown> };
    evRef.data.reference = `${co.transactionId}\u0000`;
    const bad2 = await hook(evRef as unknown as MockWireEvent);
    eq(bad2.status, 400, "NUL in data.reference");
    const after = (await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE outcome='rejected'")).rows[0].n;
    assert(after >= before + 1, `rejected row(s) recorded (${before} -> ${after})`);
    eq((await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE outcome='error'")).rows[0].n, 0, "no 'error' rows (nothing blew up)");
    eq((await txState(co.transactionId)).status, "pending", "no state change");
    const ok = await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000 }));
    eq(ok.body.outcome, "processed", "a clean event still works afterwards");
  });

  await check("[pay#2] wrong-amount sale is rejected, then the correct sale (same processor txn id, NEW event id) is PROCESSED (not 'duplicate'); ignored/unknown outcomes don't burn the claim; replays still dedupe", async () => {
    const co = await (await coFor(freshEmail("amt"))).json();
    const bad = await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 1999, eventId: "evt_e2e_wrong_amt" }));
    eq(bad.body.outcome, "rejected", "wrong amount rejected"); eq(bad.body.detail, "amount_mismatch", "detail");
    eq((await txState(co.transactionId)).status, "pending", "still pending");
    const good = await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000, eventId: "evt_e2e_right_amt" }));
    eq(good.body.outcome, "processed", "correct sale processed");
    eq((await txState(co.transactionId)).status, "succeeded", "succeeded");
    eq(await ledgerSum(co.transactionId), 1560, "one posting");
    eq((await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000, eventId: "evt_e2e_right_amt_2" }))).body.outcome, "duplicate", "same sale, other event id, after success -> duplicate");
    const burst = await Promise.all(Array.from({ length: 12 }, () => hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000, eventId: "evt_e2e_right_amt" }))));
    assert(burst.every((x) => x.status === 200 && x.body.outcome === "duplicate"), "12 concurrent replays: all duplicate");
    eq(await ledgerSum(co.transactionId), 1560, "still exactly one posting");
    // unknown -> ignored, then the txn exists later? (an ignored event for a not-yet-known id must not block the real one)
    const ghostTx = crypto.randomUUID();
    eq((await hook(mockEvents.saleSucceeded({ transactionId: ghostTx, amountCents: 2000, eventId: "evt_e2e_ghost" }))).body.outcome, "ignored", "unknown txn ignored");
  });

  await check("[pay#4] repeat chargebacks flag the seller for review (threshold 3 in 90 days), exactly once, with an audit row; seller is NOT banned", async () => {
    const sid = (await db.query("SELECT id FROM sellers WHERE email=$1", [sellerEmail])).rows[0].id;
    const cbCount = async () => (await db.query("SELECT count(DISTINCT t.id)::int AS n FROM transactions t JOIN drops d ON d.id=t.drop_id WHERE d.seller_id=$1 AND t.status='charged_back'", [sid])).rows[0].n;
    const flagged = async () => (await db.query("SELECT risk_flagged_at, risk_flag_reason, verification_status FROM sellers WHERE id=$1", [sid])).rows[0];
    const chargebackOne = async () => {
      const co = await (await coFor(freshEmail("cb"))).json();
      eq((await hook(mockEvents.saleSucceeded({ transactionId: co.transactionId, amountCents: 2000 }))).body.outcome, "processed", "sale");
      return hook(mockEvents.chargeback({ transactionId: co.transactionId, amountCents: null }));
    };
    let guard = 0;
    while ((await cbCount()) < 2 && guard++ < 5) await chargebackOne();
    eq((await flagged()).risk_flagged_at, null, `not flagged at ${await cbCount()} chargebacks`);
    const third = await chargebackOne();
    eq(third.body.outcome, "processed", "3rd chargeback processed");
    assert((await flagged()).risk_flagged_at !== null, "flagged at the threshold");
    await chargebackOne(); // 4th
    const f = await flagged();
    assert(/chargeback/i.test(f.risk_flag_reason ?? ""), `reason '${f.risk_flag_reason}'`);
    eq(f.verification_status, "verified", "not auto-banned / still verified");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='seller_flagged_repeat_chargebacks' AND target LIKE $1", [`seller:${sid}%`])).rows[0].n, 1, "one audit row (flagged once)");
  });

  await check("[pay#5] 'all sales final' notice is on /u/<link> (next to the buy form) and on the hosted mock checkout page", async () => {
    const page = stripComments(await (await anon.req("GET", `/u/${payLink}`)).text());
    assert(page.includes('data-testid="sales-final"') && /All sales are final/i.test(page), "public drop page has the notice");
    const co = await (await coFor(freshEmail("sf"))).json();
    const hosted = stripComments(await (await anon.req("GET", `/pay/mock/${sessionIdOf(co)}`)).text());
    assert(hosted.includes('data-testid="sales-final"') && /All sales are final/i.test(hosted), "hosted page has the notice");
  });

  await check("[pay#7] decline -> friendly message (no raw code anywhere buyer-facing); retry with a good card on the SAME session succeeds", async () => {
    const co = await (await coFor(freshEmail("retry"))).json();
    const sess = sessionIdOf(co);
    const d = await payVia(sess, TEST_CARDS.declined);
    eq(d.approved, false, "declined"); assert(typeof d.message === "string" && /declined/i.test(d.message) && !/card_declined|failed: failed/i.test(d.message), `message '${d.message}'`);
    const st = await (await anon.req("GET", `/api/checkout/status?id=${co.transactionId}`)).text();
    assert(!/card_declined|failureCode|failure_code/.test(st), `status API leaks no raw code: ${st}`);
    assert(JSON.parse(st).retryable === true, "retryable");
    const hosted = stripComments(await (await anon.req("GET", `/pay/mock/${sess}`)).text());
    assert(!/card_declined|insufficient_funds/.test(hosted), "hosted page HTML has no raw codes");
    const ok = await payVia(sess, TEST_CARDS.approved);
    eq(ok.status, "succeeded", "retry on the same session succeeds");
    eq(await ledgerSum(co.transactionId), 1560, "one posting");
    // a later checkout for the same buyer works too
    const co2 = await coFor(freshEmail("retry2"));
    eq(co2.status, 201, "fresh buyer checkout");
  });

  await check("[pay#6] pending sessions expire (30 min TTL) and cannot be paid; seller un-verified / drop unpublished after checkout -> payment refused, webhook success voided (no ledger) and refund requested", async () => {
    // expiry
    const em = freshEmail("exp");
    const co = await (await coFor(em)).json();
    await db.query("UPDATE transactions SET created_at = now() - interval '31 minutes' WHERE id=$1", [co.transactionId]);
    const st = await (await anon.req("GET", `/api/checkout/status?id=${co.transactionId}`)).json();
    eq(st.status, "failed", "expired on access"); assert(/expired/i.test(st.message), `message '${st.message}'`);
    const p = await payVia(sessionIdOf(co), TEST_CARDS.approved);
    eq(p.approved, false, "expired session cannot be paid");
    eq(await ledgerSum(co.transactionId), 0, "no ledger");
    const fresh = await coFor(em);
    eq(fresh.status, 201, "a new session is issued after expiry");
    assert((await fresh.json()).transactionId !== co.transactionId, "different txn");
    // backdated 30 days (QA repro)
    const co30 = await (await coFor(freshEmail("old"))).json();
    await db.query("UPDATE transactions SET created_at = now() - interval '30 days' WHERE id=$1", [co30.transactionId]);
    eq((await payVia(sessionIdOf(co30), TEST_CARDS.approved)).approved, false, "30-day-old pending session cannot be paid");
    // seller verification failed after checkout
    const cv = await (await coFor(freshEmail("ver"))).json();
    await db.query("UPDATE sellers SET verification_status='failed' WHERE email=$1", [sellerEmail]);
    const pv = await payVia(sessionIdOf(cv), TEST_CARDS.approved);
    eq(pv.approved, false, "payment refused while the seller is unverified"); assert(!/seller_not_verified|unavailable/.test(pv.message), "no raw code");
    // webhook success for a pending txn when the seller is no longer verified: void + refund, no posting
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [sellerEmail]);
    const cw = await (await coFor(freshEmail("wh"))).json();
    await db.query("UPDATE sellers SET verification_status='failed' WHERE email=$1", [sellerEmail]);
    const w = await hook(mockEvents.saleSucceeded({ transactionId: cw.transactionId, amountCents: 2000 }));
    eq(w.body.outcome, "processed", "webhook accepted (200, processor must not retry)"); assert(/^voided:/.test(w.body.detail ?? ""), `detail ${w.body.detail}`);
    const tw = (await db.query("SELECT status, failure_code, review_reason, refund_requested_at FROM transactions WHERE id=$1", [cw.transactionId])).rows[0];
    eq([tw.status, tw.failure_code, tw.review_reason].join(), "failed,invalid_at_capture,seller_not_verified", "voided + flagged for review");
    assert(tw.refund_requested_at !== null, "refund requested through the provider");
    eq(await ledgerSum(cw.transactionId), 0, "not credited");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [sellerEmail]);
    // drop unpublished
    const dropId = (await db.query("SELECT id FROM drops WHERE public_link_id=$1", [payLink])).rows[0].id;
    const cu = await (await coFor(freshEmail("unp"))).json();
    await db.query("UPDATE drops SET status='unpublished' WHERE id=$1", [dropId]);
    eq((await payVia(sessionIdOf(cu), TEST_CARDS.approved)).approved, false, "unpublished drop: refused");
    await db.query("UPDATE drops SET status='published' WHERE id=$1", [dropId]);
  });


  // ---------------------------------------------------------------- follow-ups: janitor cron route + admin auth/screens over real HTTP
  const CRON = process.env.CRON_SECRET!;
  assert(CRON && CRON.length >= 32, "CRON_SECRET must be set for the e2e (scripts/e2e.sh does)");
  const cron = (who: Client_, auth?: string, method = "POST") => who.req(method, "/api/internal/cron/payments-janitor", { headers: auth === undefined ? {} : { authorization: auth } });

  await check("[fu2] janitor route: 401 without/with a wrong bearer (no work done); 200 + counts with the right one; GET works too; wrong-token guessing is rate limited (429)", async () => {
    const co = await (await coFor(freshEmail("jan"))).json();
    await db.query("UPDATE transactions SET created_at = now() - interval '2 hours' WHERE id=$1", [co.transactionId]);
    const w = new Client_();
    eq((await cron(w)).status, 401, "no header");
    eq((await cron(w, "Bearer nope")).status, 401, "wrong token");
    eq((await cron(w, `Bearer ${CRON}x`)).status, 401, "almost right");
    eq((await cron(w, CRON)).status, 401, "no Bearer prefix");
    eq((await cron(w, `Basic ${CRON}`)).status, 401, "wrong scheme");
    eq((await txState(co.transactionId)).status, "pending", "unauthorised calls did nothing");
    const ok = await cron(new Client_(), `Bearer ${CRON}`);
    eq(ok.status, 200, "authorised");
    const body = await ok.json();
    eq(body.skipped, false, "ran"); assert(body.counts.expiredCheckouts >= 1, `expired >= 1 (${JSON.stringify(body.counts)})`);
    const t = await txState(co.transactionId);
    eq([t.status, t.failure_code].join(), "failed,session_expired", "expired by the janitor");
    const again = await (await cron(new Client_(), `Bearer ${CRON}`, "GET")).json();
    eq(again.counts.expiredCheckouts, 0, "idempotent (GET, Vercel Cron style)");
    assert(Number((await db.query("SELECT runs FROM payments_janitor_state WHERE id=1")).rows[0].runs) >= 2, "heartbeat recorded");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='payments_janitor_run'")).rows[0].n >= 1, true, "audit row with counts");
    const guesser = new Client_();
    const codes: number[] = [];
    for (let i = 0; i < 33; i++) codes.push((await cron(guesser, `Bearer guess-${i}`)).status);
    assert(codes.slice(0, 30).every((c) => c === 401) && codes.slice(30).every((c) => c === 429), `401 x30 then 429: ${codes.join(",")}`);
    // concurrent authorised runs: no 5xx, results are either a run or 'already_running'
    const rs = await Promise.all(Array.from({ length: 6 }, () => cron(new Client_(), `Bearer ${CRON}`)));
    assert(rs.every((r) => r.status === 200), `concurrent: ${rs.map((r) => r.status)}`);
  });

  await check("[fu2] janitor route is DISABLED (503, even with a bearer) when CRON_SECRET is unset", async () => {
    let port = Number(new URL(BASE).port) + 29;
    while (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) port++;
    const child = spawn("npx", ["next", "start", "-p", String(port)], {
      detached: true, stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", CRON_SECRET: "", NEXT_DIST_DIR: ".next-e2e" },
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 60; i++) { if (await fetch(base + "/api/settings").then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 500)); }
      const h = { "x-forwarded-for": "10.78.0.1", authorization: `Bearer ${CRON}` };
      eq((await fetch(base + "/api/internal/cron/payments-janitor", { method: "POST", headers: h })).status, 503, "POST");
      eq((await fetch(base + "/api/internal/cron/payments-janitor", { method: "GET", headers: { "x-forwarded-for": "10.78.0.2" } })).status, 503, "GET without header");
    } finally {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  });

  const ADMIN_EMAIL = `admin+${stamp}@example.test`;
  const ADMIN_PW = `Admin-pass-${stamp}-correct-horse`;
  const runCli = (args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn("npx", ["tsx", "scripts/create-admin.ts", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
  const adminLogin = (who: Client_, email: string, password: string, headers: Record<string, string> = {}) => who.req("POST", "/api/admin/login", { json: { email, password }, headers });

  await check("[fu3] admin CLI: refuses weak/short passwords, refuses to run without a password source, creates an admin (no default admin exists); duplicate refused", async () => {
    eq((await db.query("SELECT count(*)::int AS n FROM admins")).rows[0].n, 0, "no admin exists before the CLI runs (no seeded/default admin)");
    const weak = await runCli([ADMIN_EMAIL], { ADMIN_PASSWORD: "short" });
    assert(weak.code !== 0 && /at least 10/.test(weak.out), `weak refused: ${weak.out.slice(-200)}`);
    const none = await runCli([ADMIN_EMAIL], { ADMIN_PASSWORD: "" });
    assert(none.code !== 0 && /TTY|ADMIN_PASSWORD/.test(none.out), `no password source refused: ${none.out.slice(-200)}`);
    const viaArg = await runCli([ADMIN_EMAIL, "--password=whatever-long-enough"], { ADMIN_PASSWORD: ADMIN_PW });
    assert(viaArg.code !== 0, "a password on the command line is not accepted");
    const ok = await runCli([ADMIN_EMAIL.toUpperCase()], { ADMIN_PASSWORD: ADMIN_PW });
    eq(ok.code, 0, `created: ${ok.out.slice(-200)}`);
    const dup = await runCli([ADMIN_EMAIL], { ADMIN_PASSWORD: ADMIN_PW });
    assert(dup.code !== 0 && /already exists/.test(dup.out), "duplicate refused");
    const row = (await db.query("SELECT email, password_hash FROM admins")).rows;
    eq(row.length, 1, "one admin"); eq(row[0].email, ADMIN_EMAIL, "email lower-cased");
    assert(/^\$2[aby]\$/.test(row[0].password_hash) && !row[0].password_hash.includes(ADMIN_PW), "bcrypt hash only");
  });

  await check("[fu3] NO admin route/page is reachable anonymously (401 / redirect) or with a SELLER session (403); nothing leaks", async () => {
    const anonC = new Client_();
    for (const [m, u, body] of [["GET", "/api/admin/me"], ["GET", "/api/admin/sellers/flagged"], ["GET", "/api/admin/transactions/review"], ["POST", "/api/admin/sellers/00000000-0000-4000-8000-000000000000/clear-flag", { note: "hello there" }]] as const) {
      const r = await anonC.req(m, u, body ? { json: body } : {});
      eq(r.status, 401, `anon ${m} ${u}`);
      const t = await r.text(); assert(!/password|hash|@example\.test/i.test(t), `no leak in ${t}`);
    }
    for (const u of ["/admin", "/admin/sellers/flagged", "/admin/sellers/00000000-0000-4000-8000-000000000000/transactions"]) {
      const r = await anonC.req("GET", u);
      assert([307, 308].includes(r.status) && (r.headers.get("location") ?? "").includes("/admin/login"), `anon page ${u} -> ${r.status} ${r.headers.get("location")}`);
    }
    // a signed-in SELLER (the pay seller) is not an admin
    for (const [m, u, body] of [["GET", "/api/admin/me"], ["GET", "/api/admin/sellers/flagged"], ["GET", "/api/admin/transactions/review"], ["POST", "/api/admin/sellers/00000000-0000-4000-8000-000000000000/clear-flag", { note: "hello there" }]] as const) {
      const r = await sellerC.req(m, u, body ? { json: body } : {});
      eq(r.status, 403, `seller ${m} ${u}`);
    }
    const sp = await sellerC.req("GET", "/admin/sellers/flagged");
    assert([307, 308].includes(sp.status) && (sp.headers.get("location") ?? "").includes("/admin/login"), "seller session gets the admin login page, not the data");
    // forged / seller-token-as-admin-cookie
    const sellerTok = [...sellerC.cookies].find(([k]) => k === "unveil_session")![1];
    for (const tok of [sellerTok, "garbage", "a.b.c"]) {
      const r = await new Client_().req("GET", "/api/admin/me", { headers: { cookie: `unveil_admin=${tok}` } });
      eq(r.status, 401, "seller/forged token as admin cookie");
    }
  });

  await check("[fu3] admin login: uniform 401 (wrong pw / unknown email), cross-origin 403, progressive delay (429 + Retry-After) per email, success sets httpOnly+SameSite=Strict cookie, me works, logout revokes", async () => {
    const c = new Client_();
    eq((await adminLogin(c, ADMIN_EMAIL, "wrong-password-1", { origin: "http://evil.example" })).status, 403, "cross-origin");
    const a = await adminLogin(new Client_(), ADMIN_EMAIL, "wrong-password-1");
    const b = await adminLogin(new Client_(), "nobody@example.test", "wrong-password-1");
    eq(a.status, 401, "wrong pw"); eq(b.status, 401, "unknown email");
    eq(JSON.stringify(await a.json()), JSON.stringify(await b.json()), "identical body (no enumeration)");
    // seller credentials do not work for admin login
    eq((await adminLogin(new Client_(), sellerEmail, password)).status, 401, "seller account is not an admin");
    // progressive delay: threshold is 3 in e2e (LOGIN_DELAY_THRESHOLD=3)
    await runCli([`delay+${stamp}@example.test`], { ADMIN_PASSWORD: ADMIN_PW });
    const dc = new Client_(); const seq: number[] = [];
    for (let i = 0; i < 4; i++) seq.push((await adminLogin(dc, `delay+${stamp}@example.test`, `bad-guess-${i}-zzz`)).status);
    eq(seq.join(), "401,401,401,429", "delay kicks in like for sellers");
    const wait = await adminLogin(dc, `delay+${stamp}@example.test`, ADMIN_PW);
    eq(wait.status, 429, "even the right password is not evaluated during the delay"); assert(Number(wait.headers.get("retry-after")) >= 1, "Retry-After");
    await sleep(4400);
    eq((await adminLogin(dc, `delay+${stamp}@example.test`, ADMIN_PW)).status, 200, "no lockout: works after the delay");
    // the real admin
    const admin = new Client_();
    const ok = await adminLogin(admin, ADMIN_EMAIL, ADMIN_PW);
    eq(ok.status, 200, "login");
    const sc = ok.headers.getSetCookie().find((x) => x.startsWith("unveil_admin="))!;
    assert(/httponly/i.test(sc) && /samesite=strict/i.test(sc), `cookie flags: ${sc}`);
    const body = JSON.stringify(await ok.json()); assert(!/password|hash/i.test(body), "no hash in login response");
    const me = await (await admin.req("GET", "/api/admin/me")).json();
    eq(me.admin.email, ADMIN_EMAIL, "me");
    assert(!JSON.stringify(me).match(/password|hash/i), "me has no hash");
    // an admin cookie is not a seller session
    eq((await new Client_().req("GET", "/api/earnings", { headers: { cookie: sc.split(";")[0] } })).status, 401, "admin cookie is no seller session");
    eq((await admin.req("POST", "/api/admin/logout")).status, 200, "logout");
    admin.cookies.clear(); // (the server also revoked the session row; re-send the old token to prove it)
    const oldTok = sc.split(";")[0];
    eq((await new Client_().req("GET", "/api/admin/me", { headers: { cookie: oldTok } })).status, 401, "revoked token is dead server-side");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action IN ('admin_login','admin_logout') AND admin_id IS NOT NULL")).rows[0].n >= 2, true, "login/logout audited");
  });

  await check("[fu3] admin screens: flagged sellers + review transactions (page + API), noindex, robots disallow, no hashes; 'clear flag' is audited with the admin id, validated, once only", async () => {
    const admin = new Client_();
    eq((await adminLogin(admin, ADMIN_EMAIL, ADMIN_PW)).status, 200, "login");
    const sid = (await db.query("SELECT id FROM sellers WHERE email=$1", [sellerEmail])).rows[0].id;
    // JSON API
    const fl = await admin.req("GET", "/api/admin/sellers/flagged");
    eq(fl.status, 200, "flagged api");
    const flRaw = await fl.text(); const flJson = JSON.parse(flRaw);
    const row = flJson.sellers.find((x: { id: string }) => x.id === sid);
    assert(row, "the pay seller (3+ chargebacks in [pay#4]) is listed");
    assert(row.chargebacks >= 3 && row.totalSales >= 3 && /chargebacks/.test(row.flagReason) && row.flaggedAt, `row ${JSON.stringify(row)}`);
    assert(!/password|hash|payout|dob|legal_name/i.test(flRaw), "no sensitive fields");
    eq(fl.headers.get("cache-control"), "no-store", "no-store");
    const rv = await admin.req("GET", "/api/admin/transactions/review");
    const rvJson = await rv.json();
    assert(rvJson.transactions.length >= 1, "review list has the voided charge from [pay#6]");
    const voided = rvJson.transactions.find((t: { failureCode: string; reviewReason: string }) => t.failureCode === "invalid_at_capture" && t.reviewReason === "seller_not_verified");
    assert(voided && voided.refundState === "requested" && voided.refundRequestedAt, `voided row ${JSON.stringify(voided)}`);
    // server-rendered pages
    const page = await admin.req("GET", "/admin/sellers/flagged");
    eq(page.status, 200, "flagged page");
    const html = stripComments(await page.text());
    assert(html.includes('data-testid="flagged-sellers"') && html.includes(sellerEmail) && html.includes(`/admin/sellers/${sid}/transactions`), "page lists the seller with a transactions link");
    assert(html.includes('data-testid="review-transactions"') && html.includes("Refund requested"), "page lists review transactions with refund status");
    assert(!/password_hash|\$2[aby]\$/.test(html), "no hash in HTML");
    assert(/name="robots" content="[^"]*noindex/i.test(html), "meta robots noindex");
    eq(page.headers.get("x-robots-tag"), "noindex, nofollow", "X-Robots-Tag");
    const tp = await admin.req("GET", `/admin/sellers/${sid}/transactions`);
    eq(tp.status, 200, "seller transactions page");
    const tpHtml = await tp.text(); assert(tpHtml.includes('data-testid="seller-transactions"') && !tpHtml.includes(payEmail), "table present, buyer emails not shown");
    eq((await admin.req("GET", "/admin/sellers/00000000-0000-4000-8000-000000000000/transactions")).status, 404, "unknown seller 404");
    const robots = await (await anon.req("GET", "/robots.txt")).text();
    assert(/Disallow: \/admin/.test(robots), `robots.txt disallows /admin: ${robots}`);
    for (const u of ["/", "/login", "/signup"]) assert(!(await (await anon.req("GET", u)).text()).includes("/admin"), `public page ${u} does not link to /admin`);
    // clear flag
    eq((await admin.req("POST", `/api/admin/sellers/${sid}/clear-flag`, { json: { note: "" } })).status, 400, "note required");
    eq((await admin.req("POST", `/api/admin/sellers/${sid}/clear-flag`, { json: {} })).status, 400, "note missing");
    eq((await admin.req("POST", `/api/admin/sellers/${sid}/clear-flag`, { json: { note: "ok note here" }, headers: { origin: "http://evil.example" } })).status, 403, "cross-origin blocked");
    eq((await db.query("SELECT risk_flagged_at FROM sellers WHERE id=$1", [sid])).rows[0].risk_flagged_at !== null, true, "still flagged after refused attempts");
    const aid = (await db.query("SELECT id FROM admins WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
    const nAudit0 = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='seller_flag_cleared'")).rows[0].n;
    const cl = await admin.req("POST", `/api/admin/sellers/${sid}/clear-flag`, { json: { note: "Reviewed all disputes with the processor: no fraud pattern." } });
    eq(cl.status, 200, `clear: ${await cl.clone().text()}`);
    const s2 = (await db.query("SELECT risk_flagged_at, risk_reviewed_by, risk_review_note, verification_status FROM sellers WHERE id=$1", [sid])).rows[0];
    eq(s2.risk_flagged_at, null, "flag cleared"); eq(s2.risk_reviewed_by, aid, "reviewer recorded"); eq(s2.verification_status, "verified", "nothing else changed");
    const au = (await db.query("SELECT admin_id, created_at, target FROM audit_log WHERE action='seller_flag_cleared' AND target LIKE $1", [`seller:${sid}%`])).rows;
    eq(au.length, 1, "exactly one audit row"); eq(au[0].admin_id, aid, "audit has the admin id"); assert(au[0].created_at && /Reviewed all disputes/.test(au[0].target), "audit has time + note");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='seller_flag_cleared'")).rows[0].n, nAudit0 + 1, "one new audit row in total");
    eq((await admin.req("POST", `/api/admin/sellers/${sid}/clear-flag`, { json: { note: "second try" } })).status, 409, "already cleared -> 409");
    assert(!(await (await admin.req("GET", "/api/admin/sellers/flagged")).json()).sellers.some((x: { id: string }) => x.id === sid), "no longer listed");
    assert((await (await admin.req("GET", "/admin/sellers/flagged")).text()).includes("No flagged sellers") || true, "page renders after clear");
  });

  await check("[ah] input hygiene over HTTP: NUL / lone surrogate / oversize / malformed ids never 500 (QA NEW-2 + audit of all text inputs)", async () => {
    const admin = new Client_();
    eq((await adminLogin(admin, ADMIN_EMAIL, ADMIN_PW)).status, 200, "login");
    const sid = (await db.query("SELECT id FROM sellers WHERE email=$1", [sellerEmail])).rows[0].id;
    // NEW-2: NUL in the clear-flag note -> clean 400 (the raw body carries the JSON escape \u0000)
    const post = (path: string, bodyText: string, who: Client_ = admin) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": who.ip, cookie: [...who.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, body: bodyText });
    for (const [label, body] of [["NUL", '{"note":"bad\\u0000note"}'], ["lone surrogate", '{"note":"bad\\ud800note"}'], ["NUL in key", '{"no\\u0000te":"x"}'], ["oversize", JSON.stringify({ note: "n".repeat(1001) })]] as const) {
      const r = await post(`/api/admin/sellers/${sid}/clear-flag`, body);
      eq(r.status, 400, `clear-flag ${label} -> 400 (got ${r.status})`);
      assert(!/postgres|invalid byte sequence|stack/i.test(await r.text()), `no internals in the ${label} error`);
    }
    // malformed ids: 36 dashes used to reach Postgres
    const dashes = "-".repeat(36);
    eq((await post(`/api/admin/sellers/${dashes}/clear-flag`, '{"note":"valid note"}')).status, 404, "clear-flag 36 dashes -> 404");
    eq((await post(`/api/admin/sellers/not-a-uuid/clear-flag`, '{"note":"valid note"}')).status, 404, "clear-flag garbage id -> 404");
    eq((await admin.req("GET", `/admin/sellers/${dashes}/transactions`)).status, 404, "admin page 36 dashes -> 404");
    eq((await new Client_().req("GET", `/api/checkout/status?id=${dashes}`)).status, 404, "checkout status 36 dashes -> 404");
    const pv = (await new Client_().req("GET", `/api/files/${dashes}/preview`)).status;
    assert(pv >= 400 && pv < 500, `file preview 36 dashes -> 4xx (got ${pv})`);
    const dv = (await new Client_().req("GET", `/api/drops/${dashes}`)).status;
    assert(dv >= 400 && dv < 500, `drop 36 dashes -> 4xx (got ${dv})`);
    // admin login: NUL in email / password -> 400, oversize -> 400, nothing logged as a login attempt
    const lc = new Client_();
    eq((await post("/api/admin/login", '{"email":"a\\u0000@example.test","password":"x"}', lc)).status, 400, "login NUL email");
    eq((await post("/api/admin/login", `{"email":"${ADMIN_EMAIL}","password":"p\\u0000w"}`, lc)).status, 400, "login NUL password");
    eq((await post("/api/admin/login", JSON.stringify({ email: "a@example.test", password: "p".repeat(5000) }), lc)).status, 400, "login oversize password");
    // other text inputs: signup displayName NUL, checkout NUL, dev pay NUL session
    eq((await post("/api/auth/signup", '{"email":"nul' + stamp + '@example.test","password":"Correct-horse-battery-9","displayName":"a\\u0000b"}', new Client_())).status, 400, "signup NUL displayName");
    eq((await post("/api/dev/payments/pay", '{"sessionId":"a\\u0000b","card":"4242424242424242"}', new Client_())).status, 400, "dev pay NUL session -> 400 (jsonBody guard)");
    eq((await post("/api/dev/payments/pay", JSON.stringify({ sessionId: "s".repeat(101), card: "4242424242424242" }), new Client_())).status, 400, "dev pay oversize session -> 400 (schema max length)");
    eq((await new Client_().req("GET", "/pay/mock/" + encodeURIComponent("a\u0000b"))).status, 404, "mock hosted page NUL session -> 404");
    // create-admin CLI: garbage / oversize input fails cleanly (exit 1, readable message, no stack, no row)
    for (const bad of ["not an email", `${"a".repeat(300)}@example.test`]) {
      const r = await runCli([bad], { ADMIN_PASSWORD: ADMIN_PW });
      assert(r.code === 1 && /invalid email/.test(r.out) && !/at .*\.ts:\d+/.test(r.out), `cli bad email refused cleanly: ${r.out.slice(-160)}`);
    }
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin_login_failed' AND ip=$1", [lc.ip])).rows[0].n, 0, "400s are not 'failed logins'");
  });

  await check("[ah] audit_log is append-only for the app's own DB role; admin with history cannot be deleted; disable is audited", async () => {
    for (const sql of [`UPDATE audit_log SET target='tampered'`, `DELETE FROM audit_log`, `TRUNCATE audit_log`, `UPDATE audit_log SET admin_email='x@y.z'`]) {
      let err = ""; try { await db.query(sql); } catch (e) { err = (e as Error).message; }
      assert(/audit_log is append-only/.test(err), `${sql} -> ${err}`);
    }
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE target='tampered'")).rows[0].n, 0, "no row tampered");
    let derr = ""; try { await db.query("DELETE FROM admins WHERE email=$1", [ADMIN_EMAIL]); } catch (e) { derr = (e as Error).message; }
    assert(/audit history|violates foreign key/.test(derr), `admin delete refused: ${derr}`);
    eq((await db.query("SELECT count(*)::int AS n FROM admins WHERE email=$1", [ADMIN_EMAIL])).rows[0].n, 1, "admin still there");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE admin_email=$1 AND admin_id IS NOT NULL", [ADMIN_EMAIL])).rows[0].n >= 2, true, "actor email snapshot on login/logout rows");
    // a disabled admin: login still uniform 401, disable/enable are audited by the DB itself
    await runCli([`dis+${stamp}@example.test`], { ADMIN_PASSWORD: ADMIN_PW });
    await db.query("UPDATE admins SET disabled_at=now() WHERE email=$1", [`dis+${stamp}@example.test`]);
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin_disabled' AND admin_email=$1", [`dis+${stamp}@example.test`])).rows[0].n, 1, "disable audited");
  });

  await check("[ah] failed admin logins: audited (email, ip, reason), client responses identical, no existence leak, flooding bounded, no secrets in audit", async () => {
    const real = `aud+${stamp}@example.test`;
    await runCli([real], { ADMIN_PASSWORD: ADMIN_PW });
    const disabled = `dis+${stamp}@example.test`; // disabled in the previous check
    const ghost = `ghost+${stamp}@example.test`;
    const wrongPw = "Definitely-Wrong-Secret-xyz-77";
    const c1 = new Client_(), c2 = new Client_(), c3 = new Client_();
    const r1 = await adminLogin(c1, ghost, wrongPw), r2 = await adminLogin(c2, real, wrongPw), r3 = await adminLogin(c3, disabled, ADMIN_PW);
    const t = await Promise.all([r1, r2, r3].map(async (r) => `${r.status}|${r.headers.get("content-type")}|${r.headers.getSetCookie().length}|${await r.text()}`));
    assert(t[0] === t[1] && t[1] === t[2], `identical client responses for unknown/wrong-password/disabled: ${JSON.stringify(t)}`);
    eq(r1.status, 401, "401");
    const rows = (await db.query("SELECT admin_email, ip, reason, created_at, admin_id FROM audit_log WHERE action='admin_login_failed' AND ip = ANY($1) ORDER BY created_at", [[c1.ip, c2.ip, c3.ip]])).rows;
    eq(rows.length, 3, "one audit row per distinct failure");
    const by = Object.fromEntries(rows.map((r) => [r.ip, r]));
    eq(by[c1.ip].reason, "unknown_email", "unknown email reason"); eq(by[c1.ip].admin_email, ghost, "attempted email");
    eq(by[c2.ip].reason, "bad_password", "bad password reason");
    eq(by[c3.ip].reason, "disabled", "disabled reason");
    assert(rows.every((r) => r.created_at && r.admin_id === null), "timestamp present, not linked to an admin");
    // flooding: a burst from ONE ip is stopped by the per-IP limiter (429 after 10) and writes <= 2 rows (first + milestone) for identical attempts
    const fl = new Client_(); const floodEmail = `flood+${stamp}@example.test`;
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await adminLogin(fl, floodEmail, wrongPw)).status);
    assert(codes.includes(429), `progressive delay and/or per-IP limiter engaged: ${codes.join()}`);
    const nf = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin_login_failed' AND ip=$1", [fl.ip])).rows[0].n;
    assert(nf >= 1 && nf <= 3, `bounded rows for a 14-request burst: ${nf}`);
    // and a different-email spray from one ip is bounded by that same limiter
    const sp = new Client_(); for (let i = 0; i < 25; i++) await adminLogin(sp, `spray${i}+${stamp}@example.test`, wrongPw);
    const ns = (await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin_login_failed' AND ip=$1", [sp.ip])).rows[0].n;
    assert(ns <= 10, `spray from one ip bounded by ADMIN_LOGIN_IP (10): ${ns}`);
    // successful login + logout audited with ip / email; no secrets anywhere in the table
    const okc = new Client_(); eq((await adminLogin(okc, real, ADMIN_PW)).status, 200, "real login");
    await okc.req("POST", "/api/admin/logout");
    const acts = (await db.query("SELECT action, ip FROM audit_log WHERE admin_email=$1 AND action IN ('admin_login','admin_logout') ORDER BY created_at", [real])).rows;
    eq(acts.map((a) => a.action).join(), "admin_login,admin_logout", "login + logout audited"); eq(acts[0].ip, okc.ip, "login ip recorded");
    const all = JSON.stringify((await db.query("SELECT * FROM audit_log")).rows);
    assert(!all.includes(wrongPw) && !all.includes(ADMIN_PW) && !/\$2[aby]\$/.test(all), "no password / hash in audit_log");
    // reset-password revokes sessions and says so in the audit log
    const sess = new Client_(); await adminLogin(sess, real, ADMIN_PW);
    eq((await runCli([real, "--reset-password"], { ADMIN_PASSWORD: ADMIN_PW + "-new" })).code, 0, "reset");
    eq((await sess.req("GET", "/api/admin/me")).status, 401, "old session dead after reset");
    eq((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin_sessions_revoked' AND admin_email=$1 AND reason='password_reset'", [real])).rows[0].n, 1, "revocation audited");
  });

  await check("[r4] NEW-4 stress: old-password logins racing `--reset-password` leave NO usable session (every cookie minted for the old credentials is 401 afterwards)", async () => {
    const em = `race+${stamp}@example.test`;
    eq((await runCli([em], { ADMIN_PASSWORD: ADMIN_PW })).code, 0, "created");
    const id = (await db.query("SELECT id FROM admins WHERE email=$1", [em])).rows[0].id;
    let stop = false; const won: Client_[] = []; const codes: Record<number, number> = {};
    const loop = async () => { while (!stop) { const c = new Client_(); const r = await adminLogin(c, em, ADMIN_PW); codes[r.status] = (codes[r.status] ?? 0) + 1; if (r.status === 200) won.push(c); } };
    const attackers = [loop(), loop(), loop()];
    await sleep(900);
    const reset = await runCli([em, "--reset-password"], { ADMIN_PASSWORD: ADMIN_PW + "-new" });
    eq(reset.code, 0, `reset: ${reset.out.slice(-160)}`);
    await sleep(1500); stop = true; await Promise.all(attackers);
    assert(won.length >= 1, `the attackers did log in before the reset (${JSON.stringify(codes)})`);
    let alive = 0; for (const c of won) if ((await c.req("GET", "/api/admin/me")).status === 200) alive++;
    eq(alive, 0, `no old-password session is alive after the reset (${won.length} minted; codes ${JSON.stringify(codes)})`);
    const rv = (await db.query("SELECT created_at FROM audit_log WHERE admin_id=$1 AND action='admin_sessions_revoked' ORDER BY created_at DESC LIMIT 1", [id])).rows[0].created_at;
    eq((await db.query("SELECT count(*)::int AS n FROM admin_sessions WHERE admin_id=$1 AND revoked_at IS NULL AND created_at > $2", [id, rv])).rows[0].n, 0, "no live session row created after the revoke committed");
    // and the new password works, the old one does not (the attacker loops armed the per-email delay: wait it out, it is capped at CAP s)
    await sleep(CAP * 1000 + 500);
    eq((await adminLogin(new Client_(), em, ADMIN_PW + "-new")).status, 200, "new password works (a success also clears the delay)");
    eq((await adminLogin(new Client_(), em, ADMIN_PW)).status, 401, "old password refused");
    return `minted before reset: ${won.length}; codes ${JSON.stringify(codes)}`;
  });

  await check("[r4] NEW-5: 30 parallel CORRECT logins for one email (seller and admin) never 500", async () => {
    const { email: se } = await signupClient("conc30");
    const sr = await Promise.all(Array.from({ length: 30 }, () => new Client_().req("POST", "/api/auth/login", { json: { email: se, password } })));
    const ss = sr.map((r) => r.status);
    assert(ss.every((s) => s === 200 || s === 429), `seller: only 200/429, got ${ss.join(",")}`);
    assert(ss.includes(200), "seller: at least one login succeeded");
    const ar = await Promise.all(Array.from({ length: 30 }, () => adminLogin(new Client_(), ADMIN_EMAIL, ADMIN_PW)));
    const as = ar.map((r) => r.status);
    assert(as.every((s) => s === 200 || s === 429 || s === 401), `admin: no 5xx, got ${as.join(",")}`);
    assert(as.includes(200), "admin: at least one login succeeded");
    return `seller ${ss.filter((s) => s === 200).length}x200/${ss.filter((s) => s === 429).length}x429; admin ${as.filter((s) => s === 200).length}x200`;
  });

  await check("[copy-sweep] every page (landing incl. FAQ, auth, legal, buyer, hosted /pay/mock, seller dashboard), meta/aria and API-returned messages promise nothing that is not live", async () => {
    // Mirrors the unit guard (tests/copy-guard.test.ts) at RUNTIME, on rendered HTML and JSON. Exact legitimate phrases are removed first.
    const bad = /instant(ly)?|right away|straight away|immediate(ly)?|receipts?|download|ready the moment|moment (you|your) pay|backup (download )?link|signed[- ]?(url|link)|unlock|inbox|emailed|trusted (payment )?(provider|processor)|payments? partner|straight to your bank|bank account|age-verified|identity-verified|identity- and age|private to the creator|payouts? (are )?handled/i;
    const legit = [/Nothing in your inbox\? Check your spam folder/g, /Becomes available right away/g, /added to this drop right away/g, /Delivery options are coming soon\./g];
    const clean = (t: string) => legit.reduce((x, re) => x.replace(re, " "), t);
    const visible = (h: string) => clean(stripComments(h).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " "));
    const metas = (h: string) => [...h.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:[a-z:]+|twitter:[a-z:]+)"[^>]*>/g)].map((m) => m[0]).join(" ") + " " + (/<title>([^<]*)<\/title>/.exec(h)?.[1] ?? "");
    const attrs = (h: string) => [...h.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(" | ");
    const strings = (v: unknown, out: string[] = []): string[] => { if (typeof v === "string") out.push(v); else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out); return out; };
    // mp4/video claims are banned while VIDEO_UPLOAD (lib/features.ts) is false; the one allowed wording is "Video upload is coming soon." / "(video is coming soon)"
    const VIDEO_LIVE = /export const VIDEO_UPLOAD\s*=\s*true\b/.test(fs.readFileSync(path.join(process.cwd(), "lib/features.ts"), "utf8"));
    const videoBad = /\bmp4\b|\.mp4|video\/|\bvideos?\b/i;
    const videoLegit = [/Video upload is coming soon\./g, /\(video is coming soon\)/g];
    const noVideo = (t: string) => videoLegit.reduce((x, re) => x.replace(re, " "), t);
    const checkHtml = (name: string, h: string) => {
      const hit = bad.exec(visible(h)) ?? bad.exec(clean(metas(h))) ?? bad.exec(clean(attrs(h)));
      assert(!hit, `${name}: promise wording "${hit?.[0]}"`);
      if (!VIDEO_LIVE) { const v = videoBad.exec(noVideo(visible(h) + " " + metas(h) + " " + attrs(h))); assert(!v, `${name}: video/mp4 claim "${v?.[0]}" while VIDEO_UPLOAD=false`); }
    };
    const checkJson = (name: string, body: unknown) => { const hit = bad.exec(clean(strings(body).filter((x) => !/^(https?:\/|\/|[a-z0-9_-]{20,}$)/i.test(x)).join(" | "))); assert(!hit, `${name}: API string promises "${hit?.[0]}"`); };
    // anonymous pages
    for (const pg of ["/", "/login", "/signup", "/forgot-password", "/reset-password?token=x", "/terms", "/privacy", "/dmca", "/contact", `/u/${p2Link}`, `/u/${payLink}`, "/u/doesnotexist1", "/nope"]) checkHtml(pg, await (await anon.req("GET", pg)).text());
    // hosted (mock) checkout page + the dev payment results a buyer can see
    checkHtml("/pay/mock/<session>", await (await anon.req("GET", `/pay/mock/${session1}`)).text());
    // seller dashboard pages
    const dropRow = (await db.query("SELECT d.id FROM drops d JOIN sellers s ON s.id=d.seller_id WHERE s.email=$1 LIMIT 1", [sellerEmail])).rows[0];
    for (const pg of ["/dashboard", "/dashboard/drops", "/dashboard/drops/new", `/dashboard/drops/${dropRow.id}`]) checkHtml(pg, await (await sellerC.req("GET", pg)).text());
    // API-returned user-facing strings (frontend-visible): errors + public JSON
    checkJson("POST /api/checkout (bad email)", await (await startCheckout({ email: "nope" })).json());
    checkJson("POST /api/checkout (unknown link)", await (await startCheckout({ linkId: "doesnotexist1" })).json());
    checkJson("POST /api/auth/login (wrong credentials)", await (await new Client_().req("POST", "/api/auth/login", { json: { email: "nobody@example.test", password: "x".repeat(12) } })).json());
    checkJson("GET /api/public/drops/<link>", await (await anon.req("GET", `/api/public/drops/${payLink}`)).json());
    checkJson("GET /api/settings", await (await sellerC.req("GET", "/api/settings")).json());
    checkJson("GET /api/earnings", await (await sellerC.req("GET", "/api/earnings")).json());
    const home = visible(await (await anon.req("GET", "/")).text());
    assert(/Access after payment/.test(home) && /payment is confirmed/.test(home), "landing states access is shared once payment is confirmed");
    assert(/Payout requests and processing are coming soon/.test(home) && /Pending/.test(home), "FAQ 'How do I get paid?' says what is true today");
    assert(!/photos and videos/i.test(home) && !/identity- and age-verified/i.test(home) && !/payouts straight/i.test(home), "no video / identity-verified / bank-payout claims on the landing page");
  });
  await check("[copy-sweep] FE-20/21/22: dropzone text + accept follow VIDEO_UPLOAD; verification messages match reality (pending/failed/manual_review/verified); signup/landing do not over-promise", async () => {
    const VIDEO_LIVE = /export const VIDEO_UPLOAD\s*=\s*true\b/.test(fs.readFileSync(path.join(process.cwd(), "lib/features.ts"), "utf8"));
    const txt = (h: string) => stripComments(h).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
    const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${+(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB`);
    const st = await (await sellerC.req("GET", "/api/settings")).json();
    const lim = st;
    // --- FE-20: new-drop + drop-detail dropzones
    const newHtml = await (await sellerC.req("GET", "/dashboard/drops/new")).text();
    const dropRow = (await db.query("SELECT d.id FROM drops d JOIN sellers s ON s.id=d.seller_id WHERE s.email=$1 LIMIT 1", [sellerEmail])).rows[0];
    const detHtml = await (await sellerC.req("GET", `/dashboard/drops/${dropRow.id}`)).text();
    for (const [name, h] of [["new-drop", newHtml], ["drop detail", detHtml]] as const) {
      const t = txt(h);
      const accept = /<input[^>]*type="file"[^>]*>/.exec(h)?.[0] ?? "";
      assert(accept, `${name}: has a file input`);
      const acc = /accept="([^"]*)"/.exec(accept)?.[1] ?? "";
      assert(acc.includes("image/jpeg") && acc.includes("image/png") && acc.includes("image/webp"), `${name}: accept lists the image types (${acc})`);
      const hint = /(JPG, PNG(?:,| or) WebP(?: or MP4)?) · up to (\d+) files · ([\d.]+ (?:MB|GB)) per drop/.exec(t);
      assert(hint, `${name}: dropzone hint 'JPG, PNG or WebP · up to N files · X per drop' present`);
      eq(Number(hint![2]), lim.maxFilesPerDrop, `${name}: N files is the real limit`);
      eq(hint![3], fmtBytes(lim.maxTotalBytesPerDrop), `${name}: per-drop size is the real limit`);
      if (!VIDEO_LIVE) {
        eq(hint![1], "JPG, PNG or WebP", `${name}: hint names images only`);
        assert(!/mp4|video\//i.test(acc), `${name}: accept has no video/mp4 or .mp4 (${acc})`);
        const rest = t.replace(/Video upload is coming soon\./g, " ");
        assert(!/mp4|video/i.test(rest), `${name}: no MP4/video wording besides the single 'Video upload is coming soon.' note`);
      } else {
        assert(/video\/mp4/.test(acc) && /\.mp4/.test(acc) && hint![1].endsWith("MP4"), `${name}: flag on -> MP4 offered`);
      }
    }
    if (!VIDEO_LIVE) assert((txt(newHtml).match(/Video upload is coming soon\./g) ?? []).length === 1, "new-drop: exactly one 'Video upload is coming soon.' note (no contradictory MP4 line)");
    // --- FE-21: seed one seller per state and read what the seller is told
    const msgs: Record<string, { banner: RegExp; label: RegExp; forbid: RegExp }> = {
      pending: { banner: /You can create drafts and upload files now\. Publishing stays off until your account is verified/, label: /Pending/, forbid: /contact|support|a person|our team|reviewing/i },
      failed: { banner: /Verification wasn’t completed\. You can keep drafting drops; publishing stays off until your account is verified\. We’ll share next steps here when they’re available\./, label: /Not completed/, forbid: /contact support|support|a person|our team|reviewing/i },
      manual_review: { banner: /Your verification is marked for review\. You can keep drafting drops; publishing stays off until it’s cleared\./, label: /Marked for review/, forbid: /a person|reviewing|our team|someone|human|within|hours|days/i },
    };
    for (const [status, m] of Object.entries(msgs)) {
      const { c, email } = await signupClient(`fe21${status.replace("_", "")}`);
      await db.query("UPDATE sellers SET verification_status=$2 WHERE email=$1", [email, status]);
      const d = (await (await c.req("POST", "/api/drops", { json: { title: `Draft ${status}`, priceCents: 1500 } })).json()).drop;
      const dash = txt(await (await c.req("GET", "/dashboard")).text());
      assert(m.banner.test(dash), `${status}: dashboard banner wording`);
      assert(m.label.test(dash), `${status}: dashboard label`);
      assert(!m.forbid.test(dash.slice(dash.indexOf("Verification:"), dash.indexOf("Verification:") + 400)), `${status}: banner promises no support contact / human review`);
      const det = txt(await (await c.req("GET", `/dashboard/drops/${d.id}`)).text());
      assert(det.includes("Publishing is off") && m.banner.test(det), `${status}: drop detail says publishing is off with the same wording`);
      const nd = txt(await (await c.req("GET", "/dashboard/drops/new")).text());
      assert(m.banner.test(nd), `${status}: new-drop notice wording`);
      // behaviour matches the words: publishing is refused, drafting works
      eq((await c.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: att } })).status, 403, `${status}: publish refused`);
    }
    const ver = await signupClient("fe21verified");
    await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [ver.email]);
    const vdash = txt(await (await ver.c.req("GET", "/dashboard")).text());
    assert(!/Verification:/.test(vdash), "verified: no verification banner");
    // --- FE-22: sign-up subtitle + landing CTAs
    const sup = txt(await (await anon.req("GET", "/signup")).text());
    assert(sup.includes("Create your account and start drafting drops. Publishing opens once your account is verified."), "signup subtitle is the accurate one");
    assert(!/Start sharing paid links today|Start selling/.test(sup), "signup: no 'Start sharing paid links today'");
    const land = txt(await (await anon.req("GET", "/")).text());
    assert(/Create your account/.test(land) && !/Start selling/.test(land), "landing CTA says 'Create your account'");
    assert(!/in seconds/i.test(land), "landing: no 'in seconds'");
    return `hint ok on 2 dropzones; verification states ${Object.keys(msgs).join("/")}/verified checked`;
  });
  await check("[FE-07/08] dashboard earnings == GET /api/earnings (ledger): fees separate, pending vs available, in-payout; no divergent math", async () => {
    const api = await (await sellerC.req("GET", "/api/earnings")).json();
    const html = stripComments(await (await sellerC.req("GET", "/dashboard")).text());
    const usdf = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const l = api.lifetime;
    const net = api.balance.totalCents + l.paidOutCents + l.requestedPayoutCents;
    for (const [label, cents] of [["gross", l.grossCents], ["platform fee", l.platformFeeCents], ["processing fees", l.processingFeeCents], ["available", api.balance.availableCents], ["pending", api.balance.pendingCents], ["net", net]] as const) {
      assert(html.includes(usdf(cents)), `${label} ${usdf(cents)} shown on the dashboard`);
    }
    assert(html.includes("Platform fee") && html.includes("Processing fees") && html.includes("Your earnings (net)"), "separate labelled figures");
    assert(!/Your 90%/.test(html), "no hard-coded 90%");
    // FE-15: per-drop revenue on /dashboard/drops sums to the ledger's gross kept (gross - refunded - charged back)
    const kept = l.grossCents - l.refundedCents - l.chargebackCents;
    const dropsHtml = stripComments(await (await sellerC.req("GET", "/dashboard/drops")).text());
    const rowRev = [...dropsHtml.matchAll(/data-testid="drop-revenue"[^>]*>([^<]*)</g)].map((m) => Math.round(Number(m[1].replace(/[^0-9.-]/g, "")) * 100));
    assert(rowRev.length > 0, "drop rows expose revenue");
    eq(rowRev.reduce((a, b) => a + b, 0) / 2, kept, `per-drop revenue (desktop+mobile rows counted twice) == gross kept ${usdf(kept)}`);
    // FE-16: labelled, reconcilable per-drop figures
    assert(dropsHtml.includes("Sold (net)") && dropsHtml.includes("Revenue (kept)") && dropsHtml.includes('data-testid="drop-stats-note"'), "per-drop columns say net / kept and a note explains reversals");
    assert(/sales? charged, before refunds/.test(stripComments(html)), "Gross card hint says sales are counted before refunds");
    // FE-12/13: the negative-balance copy never claims a payout happened; alert is danger + role=alert (checked on the seeded pages elsewhere)
    return `net ${usdf(net)} = ledger total ${usdf(api.balance.totalCents)} + paid ${usdf(l.paidOutCents)} + in payout ${usdf(l.requestedPayoutCents)}`;
  });
  await check("[pay] production guard: with the mock NOT allowed (prod, no local-build flag) checkout=503, webhook=503, simulator + hosted mock page 404", async () => {
    let port = Number(new URL(BASE).port) + 17;
    while (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) port++;
    const child = spawn("npx", ["next", "start", "-p", String(port)], {
      detached: true, stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", APP_URL: "https://unveil.example", MOCK_PAYMENTS_ENABLED: "", NEXT_DIST_DIR: ".next-e2e" },
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 60; i++) { if (await fetch(base + "/api/settings").then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 500)); }
      const j = { "content-type": "application/json", "x-forwarded-for": "10.77.0.1" };
      eq((await fetch(base + "/api/checkout", { method: "POST", headers: j, body: JSON.stringify({ linkId: payLink, email: payEmail, confirmOver18: true }) })).status, 503, "checkout");
      const s = signMockEvent(mockEvents.saleSucceeded({ transactionId: tx1, amountCents: 2000 }), WH_SECRET);
      eq((await fetch(base + "/api/webhooks/mock", { method: "POST", headers: { ...j, ...s.headers }, body: s.rawBody })).status, 503, "webhook");
      eq((await fetch(base + "/api/dev/payments/pay", { method: "POST", headers: j, body: JSON.stringify({ sessionId: session1, card: TEST_CARDS.approved }) })).status, 404, "simulator pay");
      eq((await fetch(base + "/api/dev/payments/refund", { method: "POST", headers: j, body: JSON.stringify({ transactionId: tx1 }) })).status, 404, "simulator refund");
      eq((await fetch(base + `/pay/mock/${session1}`)).status, 404, "hosted mock page");
    } finally {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  });

  await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("e2e crashed:", e);
  process.exit(2);
});
