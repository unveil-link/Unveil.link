import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.SIGNED_URL_SECRET = "unit-test-secret-unit-test-secret-1234";
  process.env.APP_URL = "http://localhost:3000";
});

describe("signed original URLs", async () => {
  const { signOriginalUrl, verifyOriginalSignature } = await import("../src/server/services/signing");
  const id = "11111111-1111-1111-1111-111111111111";
  const parts = (p: string) => {
    const u = new URL("http://x" + p);
    return [u.searchParams.get("exp"), u.searchParams.get("sig")] as const;
  };

  it("accepts a fresh signature", () => {
    const [exp, sig] = parts(signOriginalUrl(id, 60).path);
    expect(verifyOriginalSignature(id, exp, sig)).toBe("ok");
  });
  it("rejects missing params", () => {
    expect(verifyOriginalSignature(id, null, null)).toBe("missing");
  });
  it("rejects expired", () => {
    const [exp, sig] = parts(signOriginalUrl(id, 60, Date.now() - 120_000).path);
    expect(verifyOriginalSignature(id, exp, sig)).toBe("expired");
  });
  it("rejects a different file id, tampered sig and extended expiry", () => {
    const [exp, sig] = parts(signOriginalUrl(id, 60).path);
    expect(verifyOriginalSignature("22222222-2222-2222-2222-222222222222", exp, sig)).toBe("bad_signature");
    expect(verifyOriginalSignature(id, exp, sig!.slice(0, -2) + "zz")).toBe("bad_signature");
    expect(verifyOriginalSignature(id, String(Number(exp) + 999), sig)).toBe("bad_signature");
  });
});
