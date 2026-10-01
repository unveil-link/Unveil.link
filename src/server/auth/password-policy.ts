import { COMMON_BASES, COMMON_EXACT } from "./common-passwords-data";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

let exact: Set<string> | null = null;
let bases: Set<string> | null = null;
const exactSet = () => (exact ??= new Set(COMMON_EXACT.split("\n")));
const baseSet = () => (bases ??= new Set(COMMON_BASES.split("\n").filter((b) => b.length >= 5)));

const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const unleet = (s: string) => s.replace(/[01345 7@$!]/g, (c) => LEET[c] ?? c);

/** All one character, or a short block repeated ("abababab", "123123123123"). */
export function isRepeated(p: string): boolean {
  if (/^(.)\1+$/s.test(p)) return true;
  for (let n = 2; n <= 4 && n * 2 <= p.length; n++) {
    if (p.length % n === 0 && p.slice(0, n).repeat(p.length / n) === p) return true;
  }
  return false;
}

/** Ascending or descending run over digits or letters ("1234567890", "abcdefghij", "9876543210"), or keyboard rows. */
export function isSequential(p: string): boolean {
  if (p.length < 4) return false;
  const codes = [...p].map((c) => c.charCodeAt(0));
  for (const dir of [1, -1]) {
    if (codes.every((c, i) => i === 0 || c - codes[i - 1] === dir)) return true;
  }
  // digits wrap: 1234567890 / 0987654321
  if ("01234567890123456789".includes(p) || "98765432109876543210".includes(p)) return true;
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "qazwsxedc", "1qaz2wsx3edc", "1q2w3e4r5t6y7u8i9o0p"];
  const lower = p.toLowerCase();
  return rows.some((r) => r.includes(lower) || [...r].reverse().join("").includes(lower));
}

/** Returns a human-readable reason, or null if the password is acceptable. */
export function checkPasswordStrength(password: string, ctx: { email?: string; displayName?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  const p = password.toLowerCase();

  if (ctx.email) {
    const email = ctx.email.trim().toLowerCase();
    const local = email.split("@")[0];
    if (p === email || p === local || (local.length >= 4 && p.replace(/[^a-z0-9]/g, "") === local.replace(/[^a-z0-9]/g, ""))) {
      return "Password must not be the same as your email address.";
    }
    if (local.length >= 5 && p.includes(local) && p.length <= local.length + 4) {
      return "Password must not be based on your email address.";
    }
  }
  if (ctx.displayName) {
    const dn = ctx.displayName.trim().toLowerCase().replace(/\s+/g, "");
    if (dn.length >= 5 && p.replace(/\s+/g, "") === dn) return "Password must not be the same as your display name.";
  }
  if (isRepeated(p)) return "Password is too repetitive (e.g. “aaaaaaaaaa” or “abcabcabcabc”). Choose something less predictable.";
  if (isSequential(p)) return "Password is a simple sequence (e.g. “1234567890” or “abcdefghij”). Choose something less predictable.";
  const variants = new Set([p, unleet(p)]);
  for (const v of variants) {
    if (exactSet().has(v)) return "That password is too common. Choose something less predictable.";
    // common word + a few trailing digits/symbols ("sunshine2024!")
    const stripped = v.replace(/[0-9!@#$%^&*._-]{1,6}$/, "");
    if (stripped !== v && baseSet().has(stripped)) return "That password is too common. Choose something less predictable.";
    // common word repeated or followed by sequence
    if (/^(.{4,12}?)\1+$/.test(v) && baseSet().has(v.match(/^(.{4,12}?)\1+$/)![1])) {
      return "That password is too common. Choose something less predictable.";
    }
  }
  return null;
}
