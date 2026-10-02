import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "../lib/api";
import { passwordRules, passwordStrength } from "../lib/password-hint";
import { DEFAULT_LIMITS, validateFile, validatePrice } from "../lib/upload-limits";
import { checkPasswordStrength } from "../src/server/auth/password-policy";
import { formatBytes, usd, fileSummaryLabel } from "../lib/format";

describe("parseRetryAfter", () => {
  it("parses delta seconds, rounds up, min 1", () => {
    expect(parseRetryAfter("12")).toBe(12);
    expect(parseRetryAfter("0")).toBe(1);
    expect(parseRetryAfter("1.2")).toBe(2);
  });
  it("parses HTTP dates", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30);
  });
  it("returns undefined for junk/missing", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("client password hints mirror the cheap backend rules", () => {
  const cases = ["short", "aaaaaaaaaaaa", "1234567890", "abcdefghij", "qwertyuiop", "abababababab", "correct-horse-battery-staple", "Sunrise-Harbor-4821"];
  for (const pw of cases) {
    it(`agrees with server on ${pw}`, () => {
      const clientOk = passwordRules(pw).every((r) => r.ok);
      const serverOk = checkPasswordStrength(pw) === null;
      // the client only knows the cheap rules: anything the server accepts, the client must also accept (no false rejections)
      if (serverOk) expect(clientOk).toBe(true);
    });
  }
  it("flags email-derived passwords", () => {
    const rules = passwordRules("maya.lin@example.test", { email: "maya.lin@example.test" });
    expect(rules.find((r) => r.id === "personal")?.ok).toBe(false);
  });
  it("strength: weak < strong", () => {
    expect(passwordStrength("short").score).toBe(1);
    expect(passwordStrength("Sunrise-Harbor-4821").score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength("").score).toBe(0);
  });
});

describe("upload validation matches backend limits", () => {
  const L = DEFAULT_LIMITS;
  it("accepts jpg/png/webp within size", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(validateFile({ name: "a", type: t, size: 1000 }, L)).toBeNull();
  });
  it("rejects other types and oversize images (15 MiB default)", () => {
    expect(validateFile({ name: "a.gif", type: "image/gif", size: 10 }, L)).toMatch(/Unsupported/);
    expect(validateFile({ name: "a.jpg", type: "image/jpeg", size: L.maxImageSizeBytes + 1 }, L)).toMatch(/15 MB/);
    expect(validateFile({ name: "a.jpg", type: "image/jpeg", size: 0 }, L)).toMatch(/empty/);
  });
  it("mp4 is recognised but blocked until the backend supports video", () => {
    expect(validateFile({ name: "a.mp4", type: "video/mp4", size: 10 }, L)).toMatch(/coming soon/);
    const on = { ...L, videoUploadEnabled: true };
    expect(validateFile({ name: "a.mp4", type: "video/mp4", size: 500 * 1024 ** 2 }, on)).toBeNull();
    expect(validateFile({ name: "a.mp4", type: "video/mp4", size: 500 * 1024 ** 2 + 1 }, on)).toMatch(/500 MB/);
  });
  it("falls back to extension when the browser gives no MIME", () => {
    expect(validateFile({ name: "x.PNG".toLowerCase(), type: "", size: 10 }, L)).toBeNull();
  });
  it("price bounds come from settings", () => {
    expect(validatePrice("", L)).toMatch(/Enter/);
    expect(validatePrice("0.99", L)).toMatch(/Minimum price is \$1\.00/);
    expect(validatePrice("500.01", L)).toMatch(/Maximum price is \$500\.00/);
    expect(validatePrice("12.345", L)).toMatch(/two decimal/);
    expect(validatePrice("1", L)).toBeNull();
    expect(validatePrice("500", L)).toBeNull();
    expect(validatePrice("5", { ...L, priceMinCents: 1000 })).toMatch(/\$10\.00/);
  });
});

describe("format helpers", () => {
  it("formats", () => {
    expect(usd(1250)).toBe("$12.50");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatBytes(15 * 1024 ** 2)).toBe("15 MB");
    expect(fileSummaryLabel([{ mime: "image/png" }, { mime: "video/mp4" }])).toBe("2 files: 1 image, 1 video");
  });
});

// FE-14 / FE-12: copy must not promise things that don't exist yet (no receipt email / order / download routes; sellers may never have been paid out).
import { readFileSync } from "node:fs";
describe("copy guards (FE-12, FE-14)", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("buyer page copy makes no receipt-email or instant-download promise", () => {
    for (const f of ["components/buyer/BuyPanel.tsx", "components/buyer/TrustPoints.tsx", "lib/purchase-copy.ts"]) {
      expect(read(f), f).not.toMatch(/receipt|and download|instant download|delivered immediately|unlock the moment/i);
    }
  });
  it("balance-owed copy does not claim a payout happened", () => {
    expect(read("src/app/dashboard/page.tsx")).not.toMatch(/after a payout|already been paid out/i);
  });
});
