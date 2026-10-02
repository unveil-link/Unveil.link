import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Copy guard: until receipts / order pages / buyer downloads actually exist, no user-facing source may promise them
 * (instant delivery, emailed receipts, backup download links, signed-link downloads, "unlock"...). See docs/frontend-dashboard-notes.md "Copy sweep".
 * Scans the frontend sources that render text (components, lib, src/app minus the backend-owned src/app/api). Comment-only lines are ignored.
 * When a match is legitimate, add the file (and a reason) to ALLOW below — keep that list short.
 */
const ROOT = join(__dirname, "..");
const SCAN = ["components", "lib", "src/app"];
const SKIP_DIRS = new Set(["node_modules", ".next", "api"]); // src/app/api is backend-owned
const FORBIDDEN = /instant(ly)?|right away|straight away|immediate(ly)?|receipt|download|deliver(y|ed|s)?|unlock|ready the moment|backup (download )?link|signed link/i;

/** file -> { reason, ok?: lines (trimmed substrings) that may match }. A file without `ok` is allowed entirely. */
const ALLOW: Record<string, { reason: string; ok?: RegExp }> = {
  "components/buyer/DownloadPanel.tsx": { reason: "post-purchase panel: presentational, NOT routed anywhere (shown only on /design)" },
  "components/design/DesignExtras.tsx": { reason: "/design showcase of DownloadPanel; page 404s unless ENABLE_DESIGN_PAGE=1", ok: /download|Download/ },
  "components/landing/Icons.tsx": { reason: "icon component name (DownloadIcon), no text" },
  "components/ui/icons.tsx": { reason: "re-exports the DownloadIcon name, no text" },
  "lib/purchase-copy.ts": { reason: "refund-policy text (SALES_FINAL_TEXT); guarded separately below", ok: /^$/ },
  "components/buyer/TrustPoints.tsx": { reason: "icon name + 'Delivery options are coming soon' (explicitly not a promise)", ok: /DownloadIcon|Delivery options are coming soon/ },
  "components/landing/BuyerTrust.tsx": { reason: "icon name + 'Delivery options are coming soon'", ok: /DownloadIcon|Delivery options are coming soon/ },
  "components/auth/AuthShell.tsx": { reason: "icon name only", ok: /DownloadIcon/ },
  "components/landing/Faq.tsx": { reason: "'Delivery options are coming soon' (explicitly not a promise)", ok: /Delivery options are coming soon/ },
  "src/app/dashboard/page.tsx": { reason: "payout hold hint 'Becomes available right away' (balance, not delivery)", ok: /Becomes available right away/ },
  "src/app/components/DropEditor.tsx": { reason: "'added to this drop right away' (uploads)", ok: /added to this drop right away/ },
  "components/dashboard/NewDropFlow.tsx": { reason: "'Publishing unlocks once you’re verified' / 'as soon as the upload finishes' (seller flow)", ok: /Publishing unlocks|as soon as the upload/ },
  "components/dashboard/types.ts": { reason: "'Publishing unlocks once your identity is verified'", ok: /Publishing unlocks/ },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mdx?)$/.test(name)) out.push(p);
  }
  return out;
}
const isComment = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l);

describe("copy guard: no user-facing promise of receipts / instant delivery / downloads", () => {
  const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(["components/landing/Hero.tsx", "components/landing/Faq.tsx", "src/app/layout.tsx"]));
  });
  it("finds no forbidden promise wording outside the allowlist", () => {
    const hits: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      const allow = ALLOW[rel];
      if (allow && !allow.ok) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (isComment(line) || !FORBIDDEN.test(line)) return;
        if (allow?.ok && allow.ok.test(line)) return;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    expect(hits, `Forbidden promise wording:\n${hits.join("\n")}`).toEqual([]);
  });
  it("allowlist entries still exist (no stale exceptions)", () => {
    for (const rel of Object.keys(ALLOW)) expect(() => statSync(join(ROOT, rel)), rel).not.toThrow();
  });
  it("refund policy keeps 'All sales are final' without delivery promises", () => {
    const t = readFileSync(join(ROOT, "lib/purchase-copy.ts"), "utf8");
    expect(t).toMatch(/All sales are final/);
    expect(t).not.toMatch(/immediately|instant/i);
  });
});
