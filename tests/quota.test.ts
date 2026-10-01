import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
});

describe("per-drop quota accounting (M1-08)", async () => {
  const { assertDropQuota } = await import("../src/server/services/images");
  const GB2 = 2 * 1024 ** 3;
  const lim = (files: number, total: number) => ({ max_files_per_drop: files, max_total_bytes_per_drop: total });
  const code = (fn: () => void) => { try { fn(); return "ok"; } catch (e) { return (e as { code?: string }).code; } };

  it("allows up to N files and rejects the N+1th", () => {
    expect(code(() => assertDropQuota({ count: 9, totalBytes: 0 }, 1, lim(10, GB2)))).toBe("ok");
    expect(code(() => assertDropQuota({ count: 10, totalBytes: 0 }, 1, lim(10, GB2)))).toBe("too_many_files");
  });
  it("counts bytes of existing files + the incoming file against the 2 GB cap (exact boundary)", () => {
    expect(code(() => assertDropQuota({ count: 3, totalBytes: GB2 - 100 }, 100, lim(10, GB2)))).toBe("ok");        // lands exactly on the cap
    expect(code(() => assertDropQuota({ count: 3, totalBytes: GB2 - 100 }, 101, lim(10, GB2)))).toBe("drop_too_large");
    expect(code(() => assertDropQuota({ count: 0, totalBytes: 0 }, GB2 + 1, lim(10, GB2)))).toBe("drop_too_large");
  });
  it("honours a lowered setting (how e2e exercises it without 2 GB)", () => {
    expect(code(() => assertDropQuota({ count: 2, totalBytes: 200 }, 100, lim(10, 300)))).toBe("ok");
    expect(code(() => assertDropQuota({ count: 3, totalBytes: 300 }, 1, lim(10, 300)))).toBe("drop_too_large");
  });
  it("reports 413 for size and 400 for count, with a readable message", () => {
    try { assertDropQuota({ count: 0, totalBytes: GB2 }, 1, lim(10, GB2)); } catch (e) {
      const h = e as { status: number; message: string };
      expect(h.status).toBe(413);
      expect(h.message).toMatch(/2 GB/);
    }
    try { assertDropQuota({ count: 10, totalBytes: 0 }, 1, lim(10, GB2)); } catch (e) {
      expect((e as { status: number }).status).toBe(400);
    }
  });
});
