import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkUnit, extractUnits, readFlags, scanSource, SCANNED_EXT, type Hit } from "./helpers/copy-scan";
import { counts, featurePinProblems, key, violations } from "./helpers/guard";
import * as allowlist from "./copy-guard.allowlist";

const { ALLOW, BACKEND_BASELINE } = allowlist;

/**
 * Copy guard (FE-18 / FE-18b). Until a feature is live, no user-facing string may promise it (instant delivery, emailed receipts, backup download links,
 * "unlock after purchase", bank payouts, trusted-provider / certification claims, video upload, "contact support", "a person is reviewing" ...). How it works:
 *  - tests/helpers/copy-scan.ts parses code with the TypeScript compiler (JSX text, string / template literals, attributes, metadata, error messages), NOT
 *    lines. Adjacent JSX text/element children are joined (In<b>stant</b>ly), String.fromCharCode / atob / concat / split-reverse-join / IIFEs are
 *    constant-folded, and unresolved dynamic string building becomes a `dynamic-string` violation. Identifiers (DownloadIcon) and comments are not strings.
 *  - text is normalised to an ASCII skeleton (NFKC, accents, Cyrillic/Greek homoglyphs, full-width, leet, zero-width, entities, spacing) and matched against
 *    semantic RULES (paraphrase-tolerant regex groups: delivery / receipt / e-mail, money, trust, capability-vs-flag, review claims, EN + ES/FR/DE core words).
 *  - flag-dependent rules read lib/features.ts (VIDEO_UPLOAD) and src/app/contact/page.tsx (placeholder?) from disk, so flipping a flag changes the verdict.
 *  - non-TS user-facing files are scanned too: CSS (content:), public/*.svg|json|webmanifest, *.mjs, next.config, markdown, html.
 *  - allowlisting is by EXACT file + EXACT string + max count with a written reason (tests/copy-guard.allowlist.ts). No file-level exemptions; stale entries fail.
 *  - scope: frontend = everything scanned outside src/server and src/app/api -> any hit fails.
 *            backend  = src/server/, src/app/api/ -> BACKEND-OWNED, we must not edit them: known hits are a reported baseline, NEW hits fail (ratchet).
 *  - tests/copy-guard-mutation.test.ts proves the guard works by injecting ~85 bad edits (QA's rounds 5 + 6 and more) into in-memory copies of real sources.
 *  - KNOWN LIMITS (see docs/frontend-dashboard-notes.md): run-time / API / DB strings, non-constant string building, unknown phrasings, images/icons, layout.
 * NOTE: this file must stay self-contained enough to run in a scratch copy that has tests/ components/ lib/ src/ public/ next.config.ts only (QA harness).
 */
const ROOT = join(__dirname, "..");
/**
 * Scope is an EXCLUDE list, not an include list, so a new top-level folder (messages/, content/, emails/ ...) is scanned by default. Only these are skipped:
 * dependencies/build output, tests, QA, docs and dev tooling, DB migrations, screenshots/proof artefacts and local data. Root-level files are scanned only if
 * they are code/config (ts/js/mjs ...), never README/NOTES markdown.
 */
export const EXCLUDED_TOP = new Set(["node_modules", ".git", "tests", "qa", "docs", "scripts", "screenshots", "proof", "db", "storage-data", "coverage", "dist", "build", "out", "tmp"]);
const ROOT_CODE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i;
const BACKEND = ["src/server", "src/app/api"];
const isBackend = (rel: string) => BACKEND.some((b) => rel === b || rel.startsWith(b + "/"));

function walk(p: string, out: string[] = []): string[] {
  if (!existsSync(p)) return out;
  if (statSync(p).isFile()) { if (SCANNED_EXT.test(p)) out.push(p); return out; }
  for (const name of readdirSync(p)) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    walk(join(p, name), out);
  }
  return out;
}
export function scanRoots(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? !e.name.startsWith(".") && !EXCLUDED_TOP.has(e.name) : ROOT_CODE.test(e.name)))
    .map((e) => e.name).sort();
}
export const allFiles = () => scanRoots().flatMap((d) => walk(join(ROOT, d))).map((f) => relative(ROOT, f)).sort();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const readOpt = (rel: string) => (existsSync(join(ROOT, rel)) ? read(rel) : null);
const flags = readFlags(readOpt);

const fmt = (hs: Hit[]) => hs.map((h) => `  ${h.file}:${h.line} [${h.rule}] "${h.text.slice(0, 140)}"`).join("\n");

describe("copy guard: allowlist hygiene", () => {
  it("every allowlist entry has a reason, names an existing file, is exact (no blanket / substring exemption) and there is no SKIP_FILES", () => {
    for (const a of [...ALLOW, ...BACKEND_BASELINE]) {
      expect(a.reason.length, a.file).toBeGreaterThan(15);
      expect(a.text.length, a.file).toBeGreaterThan(1);
      expect(a.count ?? 1, a.file).toBeGreaterThan(0);
      expect(() => statSync(join(ROOT, a.file)), a.file).not.toThrow();
    }
    for (const a of ALLOW) expect(isBackend(a.file), `${a.file} is backend-owned: use BACKEND_BASELINE`).toBe(false);
    for (const a of BACKEND_BASELINE) expect(isBackend(a.file), a.file).toBe(true);
    const keys = [...ALLOW, ...BACKEND_BASELINE].map(key);
    expect(new Set(keys).size, "duplicate allowlist entries (use count)").toBe(keys.length);
    expect(Object.keys(allowlist), "no file-level exemptions exist").not.toContain("SKIP_FILES");
  });
});

describe("copy guard: user-facing source promises nothing that is not live", () => {
  const files = allFiles();
  const hits = files.flatMap((rel) => scanSource(rel, read(rel), flags));

  it("scans the whole frontend (and backend paths, ratchet) incl. non-TS user-facing files, and extracts real strings", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const must of ["components/landing/Hero.tsx", "components/landing/Faq.tsx", "components/buyer/DownloadPanel.tsx", "components/auth/AuthShell.tsx", "src/app/layout.tsx", "src/app/u/[linkId]/page.tsx", "lib/purchase-copy.ts", "src/server/services/password-reset.ts", "src/app/api/checkout/route.ts", "next.config.ts", "src/app/dashboard/page.tsx", "src/app/globals.css", "src/server/auth/common-passwords-data.ts"]) expect(files, must).toContain(must);
    const tsUnits = files.filter((f) => /\.tsx?$/.test(f)).flatMap((rel) => extractUnits(rel, read(rel)));
    expect(tsUnits.length).toBeGreaterThan(1500);
    expect(tsUnits.some((u) => u.file === "components/landing/Faq.tsx" && /How do I get paid/.test(u.text))).toBe(true);
    expect(tsUnits.some((u) => u.file === "src/app/layout.tsx" && /shareable payment link/.test(u.text))).toBe(true);
  });

  it("scope is an exclude-list: every top-level folder / root code file is scanned except the explicit non-user-facing ones", () => {
    const roots = scanRoots();
    for (const must of ["components", "lib", "src", "public", "next.config.ts"]) expect(roots, must).toContain(must);
    for (const never of ["tests", "docs", "qa", "scripts", "node_modules", "db", "screenshots", "proof"]) expect(roots, never).not.toContain(never);
    expect(roots.every((r) => !r.startsWith(".")), "no hidden dirs").toBe(true);
    // anything else at the top level (messages/, content/, emails/ ...) must therefore be scanned: nothing outside the exclude-list is silently skipped
    const top = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !EXCLUDED_TOP.has(e.name)).map((e) => e.name);
    for (const d of top) expect(roots, d).toContain(d);
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
    if (known.length) console.warn(`[copy-guard] ${known.length} known backend-owned hit(s) tolerated (baseline):\n${fmt(known.filter((h) => !h.file.endsWith("common-passwords-data.ts")))}\n  + ${known.filter((h) => h.file.endsWith("common-passwords-data.ts")).length} password-blocklist words`);
  });

  it("no stale allowlist / baseline entries (each exemption still matches a real hit, at least `count` times)", () => {
    const c = counts(hits);
    const stale = [...ALLOW, ...BACKEND_BASELINE].filter((a) => (c.get(key(a)) ?? 0) < (a.count ?? 1));
    expect(stale.map((a) => `${a.file}: "${a.text}" (count ${a.count ?? 1}, found ${c.get(key(a)) ?? 0})`), "stale allowlist entries").toEqual([]);
  });

  it("refund policy keeps 'All sales are final' without delivery promises", () => {
    const t = read("lib/purchase-copy.ts");
    expect(t).toMatch(/All sales are final/);
    expect(checkUnit({ file: "lib/purchase-copy.ts", line: 1, text: t.match(/SALES_FINAL_TEXT[^"`]*["`]([^"`]*)/)?.[1] ?? "" }, flags)).toEqual([]);
  });
});

describe("copy guard: feature flags must match what the backend really does", () => {
  it("VIDEO_UPLOAD=true requires real video support in the backend (non-comment 'video/mp4' handling in src/server or src/app/api)", () => {
    if (!flags.videoUpload) return;
    const back = allFiles().filter((f) => isBackend(f) && /\.tsx?$/.test(f));
    const supports = back.some((f) => extractUnits(f, read(f)).some((u) => /video\/mp4/i.test(u.text)));
    expect(supports, "lib/features.ts says VIDEO_UPLOAD = true but the backend has no video/mp4 handling (POST /api/drops/:id/files would answer 415) - keep the flag false until backend ships video").toBe(true);
  });

  it("flags.contactPlaceholder tracks the real /contact page (support promises are banned only while it is a placeholder)", () => {
    expect(flags.contactPlaceholder).toBe(/ComingSoon/.test(read("src/app/contact/page.tsx")));
  });

  it("payout copy constants equal the backend defaults (platform_settings: payout_hold_days=7, min_payout_cents=2500)", () => {
    expect(featurePinProblems(read("lib/features.ts"))).toEqual([]);
    const sql = readOpt("db/migrations/006_payments.sql"); // not present in QA's scratch copy: the pins above still apply
    if (sql) {
      expect(sql).toMatch(/payout_hold_days\s+integer NOT NULL DEFAULT 7\b/);
      expect(sql).toMatch(/min_payout_cents\s+integer NOT NULL DEFAULT 2500\b/);
    }
  });
});
