import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkUnit, extractUnits, scanSource, type Hit } from "./helpers/copy-scan";
import { ALLOW, BACKEND_BASELINE, SKIP_FILES, type Allow } from "./copy-guard.allowlist";

/**
 * Copy guard (FE-18). Until a feature is live, no user-facing string may promise it (instant delivery, emailed receipts, backup download links, signed
 * links, "unlock after purchase", bank payouts, trusted-provider claims, video upload ...). How it works:
 *  - tests/helpers/copy-scan.ts parses every source file with the TypeScript compiler and extracts JSX text, string literals (attributes such as
 *    aria-label / title / alt, metadata, error messages), template literals and string concatenation / join(""), NOT lines. Identifiers (DownloadIcon)
 *    and comments are never strings, so they neither trigger nor hide hits.
 *  - strings are normalised (NFKC, zero-width chars, HTML entities, spacing) and matched against many synonyms (see FORBIDDEN) + a letters-only check.
 *  - allowlisting is by EXACT file + EXACT string with a written reason (tests/copy-guard.allowlist.ts); no file is exempt; stale entries fail.
 *  - scope: frontend = components/, lib/, src/app/ (except src/app/api), next.config.ts  -> any hit fails.
 *            backend  = src/server/, src/app/api/ -> BACKEND-OWNED, we must not edit them: known hits are a reported baseline, NEW hits fail (ratchet).
 *  - tests/copy-guard-mutation.test.ts proves the guard works by injecting ~25 bad edits into in-memory copies of the real sources.
 */
const ROOT = join(__dirname, "..");
const FRONTEND = ["components", "lib", "src/app", "next.config.ts"];
const BACKEND = ["src/server", "src/app/api"];
const isBackend = (rel: string) => BACKEND.some((b) => rel === b || rel.startsWith(b + "/"));

function walk(p: string, out: string[] = []): string[] {
  if (statSync(p).isFile()) { if (/\.tsx?$/.test(p)) out.push(p); return out; }
  for (const name of readdirSync(p)) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    walk(join(p, name), out);
  }
  return out;
}
export const allFiles = () => [...FRONTEND, ...BACKEND].flatMap((d) => walk(join(ROOT, d))).map((f) => relative(ROOT, f)).filter((r) => !(r in SKIP_FILES));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const key = (a: { file: string; text: string }) => `${a.file}\u0000${a.text}`;
function violations(hits: Hit[], list: Allow[]): Hit[] {
  const ok = new Set(list.map(key));
  return hits.filter((h) => !ok.has(key(h)));
}
const fmt = (hs: Hit[]) => hs.map((h) => `  ${h.file}:${h.line} [${h.rule}] "${h.text.slice(0, 140)}"`).join("\n");

describe("copy guard: allowlist hygiene", () => {
  it("every allowlist entry has a reason, names an existing file and is not a blanket/substring exemption", () => {
    for (const a of [...ALLOW, ...BACKEND_BASELINE]) {
      expect(a.reason.length, a.file).toBeGreaterThan(15);
      expect(a.text.length, a.file).toBeGreaterThan(2);
      expect(() => statSync(join(ROOT, a.file)), a.file).not.toThrow();
    }
    for (const a of ALLOW) expect(isBackend(a.file), `${a.file} is backend-owned: use BACKEND_BASELINE`).toBe(false);
    for (const a of BACKEND_BASELINE) expect(isBackend(a.file), a.file).toBe(true);
    for (const [f, why] of Object.entries(SKIP_FILES)) { expect(why.length).toBeGreaterThan(15); expect(() => statSync(join(ROOT, f))).not.toThrow(); }
  });
});

describe("copy guard: user-facing source promises nothing that is not live", () => {
  const files = allFiles();
  const hits = files.flatMap((rel) => scanSource(rel, read(rel)));

  it("scans the whole frontend (and backend paths, ratchet) and extracts real strings", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const must of ["components/landing/Hero.tsx", "components/landing/Faq.tsx", "components/buyer/DownloadPanel.tsx", "components/auth/AuthShell.tsx", "src/app/layout.tsx", "src/app/u/[linkId]/page.tsx", "lib/purchase-copy.ts", "src/server/services/password-reset.ts", "src/app/api/checkout/route.ts", "next.config.ts", "src/app/dashboard/page.tsx"]) expect(files, must).toContain(must);
    const units = files.flatMap((rel) => extractUnits(rel, read(rel)));
    expect(units.length).toBeGreaterThan(1500);
    expect(units.some((u) => u.file === "components/landing/Faq.tsx" && /How do I get paid/.test(u.text))).toBe(true);
    expect(units.some((u) => u.file === "src/app/layout.tsx" && /shareable payment link/.test(u.text))).toBe(true);
  });

  it("FRONTEND: no forbidden promise outside the exact-string allowlist", () => {
    const v = violations(hits.filter((h) => !isBackend(h.file)), ALLOW);
    expect(v, `Forbidden promise wording (fix the copy, or allowlist the exact string with a reason):\n${fmt(v)}`).toEqual([]);
  });

  it("BACKEND-OWNED paths: no NEW forbidden string beyond the reported baseline", () => {
    const back = hits.filter((h) => isBackend(h.file));
    const v = violations(back, BACKEND_BASELINE);
    expect(v, `NEW forbidden string in backend-owned code (report to Backend):\n${fmt(v)}`).toEqual([]);
    const known = back.filter((h) => !v.includes(h));
    if (known.length) console.warn(`[copy-guard] ${known.length} known backend-owned hit(s) tolerated (baseline):\n${fmt(known)}`);
  });

  it("no stale allowlist / baseline entries (each exemption still matches a real hit)", () => {
    const seen = new Set(hits.map(key));
    const stale = [...ALLOW, ...BACKEND_BASELINE].filter((a) => !seen.has(key(a)));
    expect(stale.map((a) => `${a.file}: "${a.text}"`), "stale allowlist entries").toEqual([]);
  });

  it("refund policy keeps 'All sales are final' without delivery promises", () => {
    const t = read("lib/purchase-copy.ts");
    expect(t).toMatch(/All sales are final/);
    expect(checkUnit({ file: "lib/purchase-copy.ts", line: 1, text: t.match(/SALES_FINAL_TEXT[^"`]*["`]([^"`]*)/)?.[1] ?? "" })).toEqual([]);
  });
});
