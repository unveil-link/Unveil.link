import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
  process.env.SIGNED_URL_SECRET = "unit-test-secret-unit-test-secret-1234";
  process.env.APP_URL = "http://localhost:3000";
});

describe("file summary (M2-07)", async () => {
  const { summarizeFiles } = await import("../src/server/services/drops");
  it("formats counts and types", () => {
    expect(summarizeFiles([{ mime: "image/jpeg" }, { mime: "image/png" }, { mime: "video/mp4" }]).label).toBe("3 files: 2 images, 1 video");
    expect(summarizeFiles([{ mime: "image/webp" }]).label).toBe("1 file: 1 image");
    expect(summarizeFiles([]).label).toBe("0 files");
  });
});

describe("signed URL default TTL (#8)", async () => {
  const { defaultTtlSeconds, signOriginalUrl } = await import("../src/server/services/signing");
  it("is 24h by default, env overrides, platform setting wins", () => {
    delete process.env.SIGNED_URL_TTL_SECONDS;
    expect(defaultTtlSeconds()).toBe(86400);
    expect(defaultTtlSeconds(null)).toBe(86400);
    process.env.SIGNED_URL_TTL_SECONDS = "600";
    expect(defaultTtlSeconds()).toBe(600);
    expect(defaultTtlSeconds(30)).toBe(30);
    process.env.SIGNED_URL_TTL_SECONDS = "junk";
    expect(defaultTtlSeconds()).toBe(86400);
    delete process.env.SIGNED_URL_TTL_SECONDS;
  });
  it("signOriginalUrl without explicit ttl expires in ~24h", () => {
    const now = Date.now();
    const { expiresAt } = signOriginalUrl("11111111-1111-1111-1111-111111111111", undefined, now);
    expect(Date.parse(expiresAt) - now).toBeGreaterThan(86400_000 - 2000);
    expect(Date.parse(expiresAt) - now).toBeLessThanOrEqual(86400_000);
  });
});

describe("mail transports (#12)", async () => {
  const mail = await import("../src/server/mail");
  it("Resend adapter builds the documented request (mocked fetch; NOT tested live)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = new mail.ResendTransport("re_key", "Unveil <a@b.co>", (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch);
    await t.send({ to: "x@y.co", subject: "s", text: "t" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ from: "Unveil <a@b.co>", to: ["x@y.co"], subject: "s" });
  });
  it("Postmark adapter builds the documented request (mocked fetch; NOT tested live)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = new mail.PostmarkTransport("pm_tok", "a@b.co", (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch);
    await t.send({ to: "x@y.co", subject: "s", text: "t" });
    expect(calls[0].url).toBe("https://api.postmarkapp.com/email");
    expect((calls[0].init.headers as Record<string, string>)["x-postmark-server-token"]).toBe("pm_tok");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ To: "x@y.co", TextBody: "t" });
  });
  it("adapters throw on provider errors", async () => {
    const t = new mail.ResendTransport("k", "a@b.co", (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch);
    await expect(t.send({ to: "x@y.co", subject: "s", text: "t" })).rejects.toThrow(/422/);
  });
});
