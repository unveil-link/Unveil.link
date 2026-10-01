import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
});

describe("progressive login delay schedule", async () => {
  const lt = await import("../src/server/ratelimit/login-throttle");
  const d = lt.DEFAULT_LOGIN_DELAY;
  it("defaults: free for the first 4 failures, then 1,2,4,8,16,32 s, capped at 60 s", () => {
    const s = Array.from({ length: 14 }, (_, i) => lt.loginDelaySeconds(i + 1, d));
    expect(s).toEqual([0, 0, 0, 0, 1, 2, 4, 8, 16, 32, 60, 60, 60, 60]);
  });
  it("never exceeds the cap, even for absurd failure counts (no overflow)", () => {
    for (const f of [50, 1_000, 1_000_000, Number.MAX_SAFE_INTEGER]) expect(lt.loginDelaySeconds(f, d)).toBe(60);
    expect(lt.loginDelaySeconds(100, { threshold: 1, baseSec: 3600, capSec: 3600, decaySec: 3600 })).toBe(3600);
  });
  it("custom base/threshold/cap", () => {
    const c = { threshold: 2, baseSec: 1, capSec: 3, decaySec: 20 };
    expect([1, 2, 3, 4, 5, 6].map((f) => lt.loginDelaySeconds(f, c))).toEqual([0, 1, 2, 3, 3, 3]);
  });
});

describe("login delay config resolution", async () => {
  const lt = await import("../src/server/ratelimit/login-throttle");
  it("defaults when nothing is set", () => {
    expect(lt.resolveLoginDelayConfig(null, {})).toEqual({ threshold: 5, baseSec: 1, capSec: 60, decaySec: 900 });
  });
  it("env overrides defaults; platform_settings overrides env; bad values are ignored", () => {
    const env = { LOGIN_DELAY_THRESHOLD: "3", LOGIN_DELAY_BASE_SECONDS: "2", LOGIN_DELAY_CAP_SECONDS: "30", LOGIN_DELAY_DECAY_SECONDS: "600" };
    expect(lt.resolveLoginDelayConfig(null, env)).toEqual({ threshold: 3, baseSec: 2, capSec: 30, decaySec: 600 });
    expect(lt.resolveLoginDelayConfig({ login_delay_cap_seconds: 10, login_delay_threshold: null }, env))
      .toEqual({ threshold: 3, baseSec: 2, capSec: 10, decaySec: 600 });
    expect(lt.resolveLoginDelayConfig(null, { LOGIN_DELAY_CAP_SECONDS: "abc", LOGIN_DELAY_THRESHOLD: "-1", LOGIN_DELAY_BASE_SECONDS: "0" }))
      .toEqual({ threshold: 5, baseSec: 1, capSec: 60, decaySec: 900 });
  });
  it("cap is bounded to 1 h (a long block is impossible by configuration); base <= cap; decay >= cap", () => {
    expect(lt.resolveLoginDelayConfig(null, { LOGIN_DELAY_CAP_SECONDS: "999999" }).capSec).toBe(60);
    const c = lt.resolveLoginDelayConfig(null, { LOGIN_DELAY_CAP_SECONDS: "5", LOGIN_DELAY_BASE_SECONDS: "50", LOGIN_DELAY_DECAY_SECONDS: "1" });
    expect(c.baseSec).toBe(5);
    expect(c.decaySec).toBe(5);
  });
});
