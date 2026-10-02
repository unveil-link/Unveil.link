import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbReachable } from "./helpers";

const available = await dbReachable();
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unveil-media-test-"));
const storageDir = path.join(tmp, "storage");
let dropDb: (() => Promise<void>) | null = null;
type Mods = {
  db: typeof import("../../src/server/db");
  drops: typeof import("../../src/server/services/drops");
  images: typeof import("../../src/server/services/images");
  video: typeof import("../../src/server/services/video");
};
let m!: Mods;
const mp4 = path.join(tmp, "t.mp4");

beforeAll(async () => {
  if (!available) return;
  const t = await createTestDb("media");
  dropDb = t.drop;
  Object.assign(process.env, {
    DATABASE_URL: t.url, APP_URL: "http://localhost:3000", RATE_LIMIT_ENABLED: "0",
    SESSION_SECRET: "x".repeat(40), SIGNED_URL_SECRET: "y".repeat(40),
    STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: storageDir,
  });
  m = {
    db: await import("../../src/server/db"),
    drops: await import("../../src/server/services/drops"),
    images: await import("../../src/server/services/images"),
    video: await import("../../src/server/services/video"),
  };
  if (hasFfmpeg) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
});
afterAll(async () => {
  if (available) { await m.db.pool().end(); await dropDb?.(); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
async function seller(verified = true) {
  const [s] = await m.db.query<{ id: string }>(
    `INSERT INTO sellers (email, password_hash, display_name, verification_status) VALUES ($1,'x','S',$2) RETURNING id`,
    [`m${++n}-${Date.now()}@example.test`, verified ? "verified" : "pending"]);
  return s.id;
}
const mk = (sid: string, over: Partial<{ title: string; priceCents: number }> = {}) =>
  m.drops.createDrop(sid, { title: over.title ?? "Original title", description: "orig desc", priceCents: over.priceCents ?? 1500 });
const png = (c = "#336699") => sharp({ create: { width: 48, height: 48, channels: 3, background: c } }).png().toBuffer();
const addImg = async (sid: string, did: string) => m.images.addImageToDrop(sid, did, { name: "i.png", data: await png(), declaredMime: "image/png" });
const addVid = (sid: string, did: string, file = mp4) =>
  m.video.addVideoToDrop(sid, did, { name: "clip.mp4", path: file, size: fs.statSync(file).size, declaredMime: "video/mp4" });
const att = { over18: true, ownsRights: true, consentOfSubjects: true };
const onDisk = (k: string) => fs.existsSync(path.join(storageDir, k));

describe.skipIf(!available)("updateDrop (PATCH service)", () => {
  it("edits title/description/price and only those; status + attestation untouched", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await addImg(sid, d.id);
    await m.drops.publishDrop(sid, d.id, att);
    const before = (await m.db.queryOne<Record<string, unknown>>("SELECT * FROM drops WHERE id=$1", [d.id]))!;
    const upd = await m.drops.updateDrop(sid, d.id, { title: "  New title ", description: "new desc", priceCents: 2500 });
    expect(upd).toMatchObject({ title: "New title", description: "new desc", price_cents: 2500, status: "published" });
    const after = (await m.db.queryOne<Record<string, unknown>>("SELECT * FROM drops WHERE id=$1", [d.id]))!;
    for (const k of ["attestation", "attested_at", "attestation_history", "published_at", "last_republished_at", "status", "public_link_id", "seller_id"]) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.attestation).toMatchObject(att);
    expect(new Date(after.updated_at as string).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at as string).getTime());
  });
  it("partial patch, description can be cleared with null", async () => {
    const sid = await seller();
    const d = await mk(sid);
    expect(await m.drops.updateDrop(sid, d.id, { priceCents: 700 })).toMatchObject({ title: "Original title", description: "orig desc", price_cents: 700 });
    expect((await m.drops.updateDrop(sid, d.id, { description: null })).description).toBeNull();
  });
  it("validates against platform_settings bounds, title length and empty patches", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await expect(m.drops.updateDrop(sid, d.id, { priceCents: 99 })).rejects.toMatchObject({ status: 400, code: "price_out_of_range" });
    await expect(m.drops.updateDrop(sid, d.id, { priceCents: 50001 })).rejects.toMatchObject({ status: 400, code: "price_out_of_range" });
    await expect(m.drops.updateDrop(sid, d.id, { priceCents: 10.5 })).rejects.toMatchObject({ status: 400 });
    await expect(m.drops.updateDrop(sid, d.id, { title: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(m.drops.updateDrop(sid, d.id, { title: "x".repeat(121) })).rejects.toMatchObject({ status: 400 });
    await expect(m.drops.updateDrop(sid, d.id, {})).rejects.toMatchObject({ status: 400, code: "empty_patch" });
    // tunable (narrower) bounds from platform_settings are honoured
    await m.db.query("UPDATE platform_settings SET price_min_cents=500, price_max_cents=2000 WHERE id=1");
    try {
      await expect(m.drops.updateDrop(sid, d.id, { priceCents: 400 })).rejects.toMatchObject({ code: "price_out_of_range" });
      await expect(m.drops.updateDrop(sid, d.id, { priceCents: 2001 })).rejects.toMatchObject({ code: "price_out_of_range" });
      expect((await m.drops.updateDrop(sid, d.id, { priceCents: 2000 })).price_cents).toBe(2000);
    } finally {
      await m.db.query("UPDATE platform_settings SET price_min_cents=100, price_max_cents=50000 WHERE id=1");
    }
    expect((await m.db.queryOne<{ price_cents: number; title: string }>("SELECT price_cents, title FROM drops WHERE id=$1", [d.id]))).toMatchObject({ price_cents: 2000, title: "Original title" });
  });
  it("another seller gets 404 and nothing changes; flagged drops are frozen", async () => {
    const a = await seller(), b = await seller();
    const d = await mk(a);
    await expect(m.drops.updateDrop(b, d.id, { title: "hijack" })).rejects.toMatchObject({ status: 404 });
    await expect(m.drops.updateDrop(a, "not-a-uuid", { title: "x" })).rejects.toMatchObject({ status: 404 });
    expect((await m.drops.getOwnedDrop(a, d.id)).title).toBe("Original title");
    await m.db.query("UPDATE drops SET status='flagged' WHERE id=$1", [d.id]);
    await expect(m.drops.updateDrop(a, d.id, { title: "x" })).rejects.toMatchObject({ status: 403, code: "flagged" });
  });
  it("writes an audit row", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await m.drops.updateDrop(sid, d.id, { priceCents: 999 });
    const rows = await m.db.query<{ target: string }>("SELECT target FROM audit_log WHERE action='drop_edited' AND target LIKE $1", [`drop:${d.id}%`]);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toContain("price_cents: 1500 -> 999");
  });
  it("dropPatchSchema: whitelist only (status/attestation/seller_id rejected), price alias, no double price", () => {
    const s = m.drops.dropPatchSchema;
    expect(s.parse({ title: "t", price_cents: 500 })).toMatchObject({ price_cents: 500 });
    for (const bad of [{ status: "published" }, { attestation: {} }, { seller_id: "x" }, { public_link_id: "x" }, { title: "t", extra: 1 }, { priceCents: 1, price_cents: 2 }, { priceCents: "5" }, { title: 5 }]) {
      expect(s.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe.skipIf(!available)("deleteDrop (DELETE service)", () => {
  it("removes drop + drop_files rows and the stored originals AND previews; audited", async () => {
    const sid = await seller();
    const d = await mk(sid);
    const f1 = await addImg(sid, d.id), f2 = await addImg(sid, d.id);
    const rows = await m.db.query<{ storage_key: string; blurred_preview_key: string }>("SELECT storage_key, blurred_preview_key FROM drop_files WHERE drop_id=$1", [d.id]);
    expect(rows).toHaveLength(2);
    for (const r of rows) { expect(onDisk(r.storage_key)).toBe(true); expect(onDisk(r.blurred_preview_key)).toBe(true); }
    const out = await m.drops.deleteDrop(sid, d.id);
    expect(out).toEqual({ deletedFiles: 2, storageErrors: 0 });
    expect(await m.db.query("SELECT 1 FROM drops WHERE id=$1", [d.id])).toHaveLength(0);
    expect(await m.db.query("SELECT 1 FROM drop_files WHERE id IN ($1,$2)", [f1.id, f2.id])).toHaveLength(0);
    for (const r of rows) { expect(onDisk(r.storage_key)).toBe(false); expect(onDisk(r.blurred_preview_key)).toBe(false); }
    expect(fs.existsSync(path.join(storageDir, "originals", d.id))).toBe(false); // empty per-drop dir is removed too
    expect(await m.db.query("SELECT 1 FROM audit_log WHERE action='drop_deleted' AND target LIKE $1", [`drop:${d.id}%`])).toHaveLength(1);
  });
  it("another seller gets 404 and nothing is deleted (DB or disk)", async () => {
    const a = await seller(), b = await seller();
    const d = await mk(a);
    await addImg(a, d.id);
    const key = (await m.db.queryOne<{ storage_key: string }>("SELECT storage_key FROM drop_files WHERE drop_id=$1", [d.id]))!.storage_key;
    await expect(m.drops.deleteDrop(b, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(m.drops.deleteDrop(a, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
    expect(await m.db.query("SELECT 1 FROM drops WHERE id=$1", [d.id])).toHaveLength(1);
    expect(onDisk(key)).toBe(true);
  });
  it("deleting twice: second is 404; a drop with zero files deletes fine", async () => {
    const sid = await seller();
    const d = await mk(sid);
    expect(await m.drops.deleteDrop(sid, d.id)).toEqual({ deletedFiles: 0, storageErrors: 0 });
    await expect(m.drops.deleteDrop(sid, d.id)).rejects.toMatchObject({ status: 404 });
  });
  it("refuses (409) when the drop has transactions (money history is RESTRICT) and when a report is open; flagged -> 403", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await addImg(sid, d.id);
    await m.db.query(`INSERT INTO reports (drop_id, reason) VALUES ($1,'x')`, [d.id]);
    await expect(m.drops.deleteDrop(sid, d.id)).rejects.toMatchObject({ status: 409, code: "drop_has_open_report" });
    await m.db.query(`UPDATE reports SET status='dismissed' WHERE drop_id=$1`, [d.id]);
    await m.db.query(
      `INSERT INTO transactions (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, processor_ref, status, provider)
       VALUES ($1,$2,'b@example.test',1500,150,180,1170,$3,'succeeded','mock')`, [d.id, sid, `ref-${d.id}`]);
    await expect(m.drops.deleteDrop(sid, d.id)).rejects.toMatchObject({ status: 409, code: "drop_has_sales" });
    expect(await m.db.query("SELECT 1 FROM drop_files WHERE drop_id=$1", [d.id])).toHaveLength(1); // untouched
    const d2 = await mk(sid);
    await m.db.query("UPDATE drops SET status='flagged' WHERE id=$1", [d2.id]);
    await expect(m.drops.deleteDrop(sid, d2.id)).rejects.toMatchObject({ status: 403 });
  });
  it("storage failure after the DB delete is reported (storageErrors) and audited, the drop stays deleted", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await addImg(sid, d.id);
    const { storage } = await import("../../src/server/storage");
    const st = storage();
    const orig = st.delete.bind(st);
    st.delete = async () => { throw new Error("boom"); };
    try {
      const out = await m.drops.deleteDrop(sid, d.id);
      expect(out).toMatchObject({ deletedFiles: 1, storageErrors: 2 });
    } finally { st.delete = orig; }
    expect(await m.db.query("SELECT 1 FROM drops WHERE id=$1", [d.id])).toHaveLength(0);
    expect(await m.db.query("SELECT 1 FROM audit_log WHERE action='drop_storage_orphans' AND target LIKE $1", [`drop:${d.id}%`])).toHaveLength(1);
  });
});

describe.skipIf(!available || !hasFfmpeg)("addVideoToDrop", () => {
  it("stores the MP4 privately (streamed), a blurred JPEG preview, mime + size; counts as a video", async () => {
    const sid = await seller();
    const d = await mk(sid);
    const out = await addVid(sid, d.id);
    expect(out).toMatchObject({ mime: "video/mp4", sizeBytes: fs.statSync(mp4).size });
    const row = (await m.db.queryOne<{ storage_key: string; blurred_preview_key: string; mime: string; size_bytes: string }>("SELECT * FROM drop_files WHERE id=$1", [out.id]))!;
    expect(row.mime).toBe("video/mp4"); expect(Number(row.size_bytes)).toBe(fs.statSync(mp4).size);
    expect(row.storage_key).toMatch(/^originals\/.+\.mp4$/); expect(row.blurred_preview_key).toMatch(/^previews\/.+\.jpg$/);
    expect(fs.readFileSync(path.join(storageDir, row.storage_key)).equals(fs.readFileSync(mp4))).toBe(true);
    expect((await sharp(fs.readFileSync(path.join(storageDir, row.blurred_preview_key))).metadata()).format).toBe("jpeg");
    expect(m.drops.summarizeFiles(await m.drops.listFiles(d.id)).label).toBe("1 file: 1 video");
  });
  it("mixed images + videos are counted correctly in the summary", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await addImg(sid, d.id); await addImg(sid, d.id); await addVid(sid, d.id);
    expect(m.drops.summarizeFiles(await m.drops.listFiles(d.id)).label).toBe("3 files: 2 images, 1 video");
    await addVid(sid, d.id);
    expect(m.drops.summarizeFiles(await m.drops.listFiles(d.id)).label).toBe("4 files: 2 images, 2 videos");
  });
  it("11th file (mix of images and videos) -> 400 too_many_files, no orphan files", async () => {
    const sid = await seller();
    const d = await mk(sid);
    for (let i = 0; i < 10; i++) { if (i % 3 === 0) await addVid(sid, d.id); else await addImg(sid, d.id); }
    await expect(addVid(sid, d.id)).rejects.toMatchObject({ status: 400, code: "too_many_files" });
    await expect(addImg(sid, d.id)).rejects.toMatchObject({ status: 400, code: "too_many_files" });
    expect(fs.readdirSync(path.join(storageDir, "originals", d.id))).toHaveLength(10);
    expect(fs.readdirSync(path.join(storageDir, "previews", d.id))).toHaveLength(10);
  });
  it("per-drop total bytes shared by images and videos (atomic locked check); parallel uploads cannot overshoot", async () => {
    const sid = await seller();
    const size = fs.statSync(mp4).size;
    await m.db.query("UPDATE platform_settings SET max_total_bytes_per_drop=$1 WHERE id=1", [size * 2 + 10]);
    try {
      const d = await mk(sid);
      const rs = await Promise.allSettled(Array.from({ length: 6 }, () => addVid(sid, d.id)));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect(rs.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "drop_too_large")).toBe(true);
      expect(fs.readdirSync(path.join(storageDir, "originals", d.id))).toHaveLength(2);
    } finally { await m.db.query("UPDATE platform_settings SET max_total_bytes_per_drop=2147483648 WHERE id=1"); }
  });
  it("per-file video cap comes from platform_settings (413); the image cap is independent", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await m.db.query("UPDATE platform_settings SET max_video_size_bytes=1000 WHERE id=1");
    try {
      await expect(addVid(sid, d.id)).rejects.toMatchObject({ status: 413, code: "file_too_large" });
      expect((await addImg(sid, d.id)).mime).toBe("image/png");
    } finally { await m.db.query("UPDATE platform_settings SET max_video_size_bytes=524288000 WHERE id=1"); }
    expect((await addVid(sid, d.id)).mime).toBe("video/mp4");
  });
  it("rejects spoofed / broken files and leaves nothing behind", async () => {
    const sid = await seller();
    const d = await mk(sid);
    const fake = path.join(tmp, "fake.mp4");
    fs.writeFileSync(fake, "MZ\u0090 pretending to be video".repeat(10));
    await expect(addVid(sid, d.id, fake)).rejects.toMatchObject({ status: 415, code: "unsupported_type" });
    const junk = path.join(tmp, "junk.mp4");
    const head = Buffer.alloc(24); head.writeUInt32BE(24, 0); head.write("ftypisom", 4, "latin1");
    fs.writeFileSync(junk, Buffer.concat([head, Buffer.alloc(3000, 0x41)]));
    await expect(addVid(sid, d.id, junk)).rejects.toMatchObject({ status: 415, code: "invalid_video" });
    expect(await m.db.query("SELECT 1 FROM drop_files WHERE drop_id=$1", [d.id])).toHaveLength(0);
    expect(fs.existsSync(path.join(storageDir, "originals", d.id))).toBe(false);
  });
  it("another seller's drop -> 404; ffmpeg missing -> 503 video_unavailable (images still work)", async () => {
    const a = await seller(), b = await seller();
    const d = await mk(a);
    await expect(addVid(b, d.id)).rejects.toMatchObject({ status: 404 });
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg"; m.video.resetFfmpegCache();
    try {
      await expect(addVid(a, d.id)).rejects.toMatchObject({ status: 503, code: "video_unavailable" });
      expect((await addImg(a, d.id)).mime).toBe("image/png");
    } finally { delete process.env.FFMPEG_PATH; m.video.resetFfmpegCache(); }
  });
  it("deleting a drop with videos removes the video original + preview from disk", async () => {
    const sid = await seller();
    const d = await mk(sid);
    await addVid(sid, d.id);
    const r = (await m.db.queryOne<{ storage_key: string; blurred_preview_key: string }>("SELECT * FROM drop_files WHERE drop_id=$1", [d.id]))!;
    expect(onDisk(r.storage_key)).toBe(true);
    await m.drops.deleteDrop(sid, d.id);
    expect(onDisk(r.storage_key)).toBe(false); expect(onDisk(r.blurred_preview_key)).toBe(false);
  });
});
