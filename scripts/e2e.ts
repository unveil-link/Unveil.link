/**
 * End-to-end proof against a running app (started by scripts/e2e.sh).
 * Talks to the app purely over HTTP, plus direct DB/filesystem inspection for evidence.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Client } from "pg";
import { signOriginalUrl } from "../src/server/services/signing";

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
class Client_ {
  cookies = new Map<string, string>();
  async req(method: string, url: string, init: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
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

  await check("logout clears session; login with wrong password = 401; correct = 200", async () => {
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
    eq((await anon.req("GET", `/d/${publicLinkId}`)).status, 404, "public page hidden");
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
    const page = await (await anon.req("GET", `/d/${publicLinkId}`)).text();
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

  await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("e2e crashed:", e);
  process.exit(2);
});
