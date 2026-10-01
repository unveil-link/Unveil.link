import { describe, expect, it } from "vitest";
import { checkPasswordStrength, isRepeated, isSequential } from "../src/server/auth/password-policy";
import { COMMON_BASES, COMMON_EXACT } from "../src/server/auth/common-passwords-data";

describe("password policy", () => {
  it("bundles a large blocklist (thousands of entries)", () => {
    expect(COMMON_EXACT.split("\n").length).toBeGreaterThan(5000);
    expect(COMMON_BASES.split("\n").length).toBeGreaterThan(5000);
  });
  it("enforces min length 10", () => {
    expect(checkPasswordStrength("Xk3$mQ9!z")).toMatch(/at least 10/);
    expect(checkPasswordStrength("Xk3$mQ9!zP")).toBeNull();
  });
  it("rejects common passwords incl. suffix/leet variants", () => {
    for (const p of ["password123", "password1234", "letmein123", "iloveyou12", "sunshine2024!", "p@ssw0rd123", "Password123", "monkeymonkey"]) {
      expect(checkPasswordStrength(p), p).toMatch(/too common/);
    }
  });
  it("rejects password == email / local part / display name", () => {
    expect(checkPasswordStrength("jane.doe@example.com", { email: "Jane.Doe@example.com" })).toMatch(/email/);
    expect(checkPasswordStrength("jane.doe2024", { email: "jane.doe@example.com" })).toMatch(/email/);
    expect(checkPasswordStrength("janedoe9999", { email: "jane.doe@example.com" })).toBeNull(); // different enough
    expect(checkPasswordStrength("Rosalind Franklin", { email: "x@y.co", displayName: "rosalind franklin" })).toMatch(/display name/);
  });
  it("rejects repeated and sequential patterns", () => {
    expect(isRepeated("aaaaaaaaaa")).toBe(true);
    expect(isRepeated("abcabcabcabc")).toBe(true);
    expect(isRepeated("abcabcabcabd")).toBe(false);
    expect(isSequential("1234567890")).toBe(true);
    expect(isSequential("abcdefghij")).toBe(true);
    expect(isSequential("9876543210")).toBe(true);
    expect(isSequential("qwertyuiop")).toBe(true);
    expect(isSequential("correct-horse")).toBe(false);
    expect(checkPasswordStrength("1234567890")).toMatch(/sequence/);
    expect(checkPasswordStrength("zzzzzzzzzzzz")).toMatch(/repetitive/);
  });
  it("accepts reasonable passphrases", () => {
    for (const p of ["correct-horse-battery", "purple-monkey-dishwasher", "Xk3$mQ9!zPw2", "welcome2unveil"]) {
      expect(checkPasswordStrength(p, { email: "seller@example.test" }), p).toBeNull();
    }
  });
});
