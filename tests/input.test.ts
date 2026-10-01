import { describe, expect, it } from "vitest";
import { assertCleanJson, cleanText, hasBadText, isUuid, sanitizeForStorage } from "../src/server/input";
import { HttpError } from "../src/server/errors";
import { jsonBody } from "../src/server/http";

const code = (fn: () => void) => { try { fn(); return null; } catch (e) { return e instanceof HttpError ? `${e.status}:${e.code}` : "other"; } };
const req = (body: string) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("isUuid (strict; the old /^[0-9a-f-]{36}$/ accepted 36 dashes -> Postgres error -> 500)", () => {
  it("accepts real uuids in either case", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")).toBe(true);
  });
  it("rejects dashes, wrong shape, NUL, whitespace, non-strings", () => {
    for (const v of ["-".repeat(36), "z".repeat(8) + "-zzzz-zzzz-zzzz-" + "z".repeat(12), "00000000-0000-4000-8000-00000000000\u0000", " 00000000-0000-4000-8000-000000000000",
      "00000000-0000-4000-8000-0000000000000", "00000000000040008000000000000000", "", "a".repeat(3000), null, undefined, 5, {}, ["00000000-0000-4000-8000-000000000000"]]) {
      expect(isUuid(v as never), String(v)).toBe(false);
    }
  });
});

describe("assertCleanJson", () => {
  it("accepts ordinary values incl. emoji, CRLF, HTML", () => {
    expect(code(() => assertCleanJson({ a: "hi 😀\r\n<b>", n: 1, b: true, z: null, arr: ["x", { y: "z" }] }))).toBeNull();
  });
  it("rejects NUL and lone surrogates in values, keys and nested/array positions", () => {
    for (const bad of ["a\u0000b", "a\ud800b", "\udc00"]) {
      expect(code(() => assertCleanJson({ note: bad }))).toBe("400:invalid_input");
      expect(code(() => assertCleanJson({ [bad]: "x" }))).toBe("400:invalid_input");
      expect(code(() => assertCleanJson({ a: { b: [bad] } }))).toBe("400:invalid_input");
      expect(code(() => assertCleanJson(bad))).toBe("400:invalid_input");
    }
  });
  it("rejects absurd nesting", () => {
    let v: unknown = "x"; for (let i = 0; i < 20; i++) v = { a: v };
    expect(code(() => assertCleanJson(v))).toBe("400:invalid_input");
  });
});

describe("jsonBody applies it to every route that reads a body", () => {
  it("NUL (JSON escape \\u0000) -> 400 invalid_input; lone surrogate escape -> 400; garbage -> 400 invalid_json; clean -> parsed", async () => {
    await expect(jsonBody(req('{"note":"abc\\u0000def"}'))).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await expect(jsonBody(req('{"note":"abc\\ud800def"}'))).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await expect(jsonBody(req("{nope"))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
    await expect(jsonBody(req('{"note":"fine 😀"}'))).resolves.toEqual({ note: "fine 😀" });
  });
});

describe("cleanText / sanitizeForStorage / hasBadText", () => {
  it("cleanText trims, bounds and rejects", () => {
    expect(cleanText("  hi  ", 10)).toBe("hi");
    expect(code(() => cleanText("a".repeat(11), 10))).toBe("400:invalid_input");
    expect(code(() => cleanText("a\u0000", 10))).toBe("400:invalid_input");
    expect(cleanText(null, 5)).toBe("");
  });
  it("sanitizeForStorage never leaves NUL/lone surrogates and truncates", () => {
    const s = sanitizeForStorage("a\u0000b\ud800c" + "x".repeat(500), 50);
    expect(hasBadText(s)).toBe(false);
    expect(s.length).toBe(50);
  });
});
