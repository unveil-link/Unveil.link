import { describe, expect, it } from "vitest";
import { requireCronAuth, safeEqual } from "../src/server/auth/cron";
import { HttpError } from "../src/server/errors";

const SECRET = "s".repeat(40);
const req = (auth?: string) => new Request("http://x/api/internal/cron/payments-janitor", { method: "POST", headers: auth === undefined ? {} : { authorization: auth } });
const code = (fn: () => void) => { try { fn(); return null; } catch (e) { return e instanceof HttpError ? e.status : "other"; } };

describe("requireCronAuth", () => {
  it("accepts exactly the bearer secret", () => {
    expect(code(() => requireCronAuth(req(`Bearer ${SECRET}`), SECRET))).toBeNull();
  });
  it("401 for missing / wrong / malformed / prefix / case-changed / basic-scheme tokens", () => {
    for (const a of [undefined, "", "Bearer", "Bearer ", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`, `Basic ${SECRET}`, SECRET, `Bearer ${"t".repeat(40)}`, `Bearer ${SECRET.toUpperCase()}`]) {
      expect(code(() => requireCronAuth(req(a), SECRET)), String(a)).toBe(401);
    }
  });
  it("503 (disabled, never open) when no secret is configured", () => {
    expect(code(() => requireCronAuth(req(`Bearer ${SECRET}`), null))).toBe(503);
    expect(code(() => requireCronAuth(req(), null))).toBe(503);
    expect(code(() => requireCronAuth(req("Bearer "), null))).toBe(503);
  });
  it("config.cronSecret ignores unset / short values", async () => {
    const { config } = await import("../src/server/config");
    const old = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET; expect(config.cronSecret).toBeNull();
      process.env.CRON_SECRET = "short"; expect(config.cronSecret).toBeNull();
      process.env.CRON_SECRET = SECRET; expect(config.cronSecret).toBe(SECRET);
    } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
  });
  it("safeEqual is length-independent and correct", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("a", "aa")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
