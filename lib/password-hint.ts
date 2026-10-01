/**
 * Client-side mirror of the *cheap* parts of the backend password policy (src/server/auth/password-policy.ts):
 * length 10..200, not the email/display name, not a repeated pattern, not a simple sequence.
 * The server additionally rejects common passwords (a ~28k-entry blocklist, deliberately NOT shipped to the browser);
 * its message is shown verbatim when it rejects (code "weak_password").
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

function isRepeated(p: string): boolean {
  if (/^(.)\1+$/s.test(p)) return true;
  for (let n = 2; n <= 4 && n * 2 <= p.length; n++) {
    if (p.length % n === 0 && p.slice(0, n).repeat(p.length / n) === p) return true;
  }
  return false;
}
function isSequential(p: string): boolean {
  if (p.length < 4) return false;
  const codes = [...p].map((c) => c.charCodeAt(0));
  for (const dir of [1, -1]) if (codes.every((c, i) => i === 0 || c - codes[i - 1] === dir)) return true;
  if ("01234567890123456789".includes(p) || "98765432109876543210".includes(p)) return true;
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "qazwsxedc", "1qaz2wsx3edc", "1q2w3e4r5t6y7u8i9o0p"];
  return rows.some((r) => r.includes(p) || [...r].reverse().join("").includes(p));
}

export type PasswordRule = { id: string; label: string; ok: boolean };

export function passwordRules(password: string, ctx: { email?: string; displayName?: string } = {}): PasswordRule[] {
  const p = password.toLowerCase();
  const email = (ctx.email ?? "").trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  const dn = (ctx.displayName ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const sameAsPersonal =
    (!!email && (p === email || p === local)) ||
    (local.length >= 5 && p.includes(local) && p.length <= local.length + 4) ||
    (dn.length >= 5 && p.replace(/\s+/g, "") === dn);
  return [
    { id: "length", label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN },
    { id: "personal", label: "Not your email or name", ok: password.length > 0 && !sameAsPersonal },
    { id: "pattern", label: "No repeats or simple sequences (aaaa…, 1234…)", ok: password.length > 0 && !isRepeated(p) && !isSequential(p) },
  ];
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tone: "danger" | "warning" | "success" | "muted" };

/** Rough strength hint for the meter (not a security guarantee; the server is authoritative). */
export function passwordStrength(password: string, ctx: { email?: string; displayName?: string } = {}): Strength {
  if (!password) return { score: 0, label: "", tone: "muted" };
  const rules = passwordRules(password, ctx);
  if (!rules.every((r) => r.ok)) return { score: password.length < PASSWORD_MIN ? 1 : 1, label: "Too weak", tone: "danger" };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const unique = new Set(password).size;
  let score = 2;
  if (password.length >= 14 || (password.length >= 12 && classes >= 3)) score = 3;
  if (password.length >= 16 && classes >= 3 && unique >= 9) score = 4;
  if (unique < 5) score = 1;
  return score <= 1
    ? { score: 1, label: "Too weak", tone: "danger" }
    : score === 2
      ? { score: 2, label: "Okay", tone: "warning" }
      : score === 3
        ? { score: 3, label: "Good", tone: "success" }
        : { score: 4, label: "Strong", tone: "success" };
}
