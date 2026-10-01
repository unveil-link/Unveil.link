import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
});

describe("rate limiter core", async () => {
  const rl = await import("../src/server/ratelimit");
  it("fixed window: allows `limit`, then blocks with Retry-After, then resets", async () => {
    let t = 1_000_000;
    const store = new rl.MemoryStore(() => t);
    const lim = { limit: 3, windowSec: 60 };
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await rl.checkLimit(store, "k", lim));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false, false]);
    expect(r[3].retryAfterSec).toBe(60);
    t += 45_000;
    expect((await rl.checkLimit(store, "k", lim)).retryAfterSec).toBe(15);
    t += 15_000;
    expect((await rl.checkLimit(store, "k", lim)).allowed).toBe(true);
  });
  it("keys are independent", async () => {
    const store = new rl.MemoryStore();
    const lim = { limit: 1, windowSec: 60 };
    expect((await rl.checkLimit(store, "a", lim)).allowed).toBe(true);
    expect((await rl.checkLimit(store, "b", lim)).allowed).toBe(true);
    expect((await rl.checkLimit(store, "a", lim)).allowed).toBe(false);
  });
  it("limits are configurable via RATE_LIMIT_<NAME>=max/windowSeconds; bad values fall back", () => {
    expect(rl.parseLimit("30/900", rl.DEFAULT_LIMITS.LOGIN_IP)).toEqual({ limit: 30, windowSec: 900 });
    expect(rl.parseLimit("nonsense", rl.DEFAULT_LIMITS.LOGIN_IP)).toEqual(rl.DEFAULT_LIMITS.LOGIN_IP);
    expect(rl.parseLimit("0/10", rl.DEFAULT_LIMITS.LOGIN_IP)).toEqual(rl.DEFAULT_LIMITS.LOGIN_IP);
    process.env.RATE_LIMIT_CHECKOUT = "2/5";
    expect(rl.limitFor("CHECKOUT")).toEqual({ limit: 2, windowSec: 5 });
    delete process.env.RATE_LIMIT_CHECKOUT;
    expect(rl.limitFor("CHECKOUT")).toEqual(rl.DEFAULT_LIMITS.CHECKOUT);
  });
  it("enforceRateLimit throws 429 with Retry-After using an injected store", async () => {
    rl.setRateLimitStore(new rl.MemoryStore());
    process.env.RATE_LIMIT_CHECKOUT = "2/60";
    try {
      await rl.enforceRateLimit("CHECKOUT", "ip1");
      await rl.enforceRateLimit("CHECKOUT", "ip1");
      await expect(rl.enforceRateLimit("CHECKOUT", "ip1")).rejects.toMatchObject({ status: 429, headers: { "Retry-After": "60" } });
      await rl.enforceRateLimit("CHECKOUT", "ip2");
    } finally {
      delete process.env.RATE_LIMIT_CHECKOUT;
      rl.setRateLimitStore(null);
    }
  });
  it("client IP = Nth-from-right X-Forwarded-For (default 1 hop), so a spoofed leftmost entry doesn't help", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(rl.clientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(rl.clientIp(req({}))).toBe("unknown");
  });
});
