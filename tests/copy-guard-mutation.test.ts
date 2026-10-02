import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanSource, type Hit } from "./helpers/copy-scan";
import { ALLOW, BACKEND_BASELINE } from "./copy-guard.allowlist";

/**
 * Self-test of the copy guard (FE-18): inject bad edits into IN-MEMORY copies of the real sources and assert the scanner + exact-string allowlist
 * flag every one. The first 18 mirror QA's qa/scripts/qa-fe5-guard-mutation.sh (M1..M18, which bypassed the old per-line guard 13 times);
 * M19+ add the evasion tricks the brief lists (entities, zero-width, spacing, concatenation, join, template literals, attributes, synonyms).
 * Nothing on disk is modified. If one of these starts failing, the guard has a hole.
 */
const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const isBackend = (f: string) => f.startsWith("src/server/") || f.startsWith("src/app/api/");
const key = (a: { file: string; text: string }) => `${a.file}\u0000${a.text}`;
function violationsOf(file: string, src: string): Hit[] {
  const ok = new Set((isBackend(file) ? BACKEND_BASELINE : ALLOW).map(key));
  return scanSource(file, src).filter((h) => !ok.has(key(h)));
}

type M = { id: string; label: string; file: string; from: RegExp | string; to: string };
const HERO_TAIL = "access to the files is shared once payment is confirmed.";
const MUTATIONS: M[] = [
  { id: "M1", label: "AuthShell: original 'Instant delivery… delivered automatically' line (same line as DownloadIcon)", file: "components/auth/AuthShell.tsx", from: /title: "One link, anywhere", body: "[^"]*"/, to: 'title: "Instant delivery", body: "Share one link anywhere. Files are delivered automatically."' },
  { id: "M2", label: "TrustPoints: 'Instant download' on the DownloadIcon line", file: "components/buyer/TrustPoints.tsx", from: /title: "Access after payment", body: "[^"]*"/, to: 'title: "Instant download", body: "Files unlock the moment you’ve paid."' },
  { id: "M3", label: "BuyerTrust: 'Instant download' on the DownloadIcon line", file: "components/landing/BuyerTrust.tsx", from: /title: "Access after payment", body: "[^"]*"/, to: 'title: "Instant download", body: "Your files are ready the moment your payment goes through."' },
  { id: "M4", label: "Hero: 'and download instantly.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "and download instantly." },
  { id: "M5", label: "Hero: 'we email you the files straight to your inbox' (no obvious forbidden word)", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "we email you the files straight to your inbox." },
  { id: "M6", label: "Hero: 'Your photos arrive in your inbox seconds after you pay' (synonyms)", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "your photos arrive in your inbox seconds after you pay." },
  { id: "M7", label: "Hero: word split by string concatenation {\"In\" + \"stantly\"}", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: 'and get them {"In" + "stantly"}.' },
  { id: "M8", label: "Hero: HTML entity 'Downl&#111;ad now'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "and Downl&#111;ad now." },
  { id: "M9", label: "layout.tsx site meta description: 'download instantly'", file: "src/app/layout.tsx", from: HERO_TAIL, to: "download instantly." },
  { id: "M10", label: "Faq: '… We email a receipt.' appended next to the allowlisted sentence", file: "components/landing/Faq.tsx", from: "Delivery options are coming soon.", to: "Delivery options are coming soon. We email a receipt." },
  { id: "M11", label: "Faq: receipt promise on a line without the allowlisted phrase", file: "components/landing/Faq.tsx", from: "with no sign-up or password.", to: "with a receipt by email." },
  { id: "M12", label: "DownloadPanel (formerly fully exempt) gains 'Instant download'", file: "components/buyer/DownloadPanel.tsx", from: /> Download</, to: "> Instant download<" },
  { id: "M13", label: "dashboard page (formerly allowlisted file): 'Buyers download instantly'", file: "src/app/dashboard/page.tsx", from: "Takes about a minute", to: "Buyers download instantly" },
  { id: "M14", label: "purchase-copy.ts: 'delivered immediately'", file: "lib/purchase-copy.ts", from: "Because this is a digital product,", to: "Because this is a digital product delivered immediately," },
  { id: "M15", label: "purchase-copy.ts: 'A receipt will be emailed to you.'", file: "lib/purchase-copy.ts", from: "once completed.", to: "once completed. A receipt will be emailed to you." },
  { id: "M16", label: "e-mail template src/server/services/password-reset.ts: receipt + download link (backend-owned, ratchet)", file: "src/server/services/password-reset.ts", from: "We received a request to reset your Unveil password.", to: "Here is your receipt and download link." },
  { id: "M17", label: "API error string src/app/api/checkout/route.ts: 'Your receipt will be emailed' (backend-owned, ratchet)", file: "src/app/api/checkout/route.ts", from: "Provide exactly one of dropId or linkId", to: "Your receipt will be emailed" },
  { id: "M18", label: "next.config.ts: promise inside a header value (file is scanned now)", file: "next.config.ts", from: "const nextConfig", to: 'const promo = { key: "X-Promo", value: "Instant download" };\nconst nextConfig' },
  { id: "M19", label: "zero-width space inside the word: 'Inst\\u200bant download'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "Inst\u200bant down\u200bload." },
  { id: "M20", label: "spacing trick: 'in stant ly' / 'down load'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "and get them in stant ly, no down load needed." },
  { id: "M21", label: "aria-label 'Pay and download button' (PaymentLinkMock)", file: "components/landing/PaymentLinkMock.tsx", from: "and a Pay button", to: "and a Pay and download button" },
  { id: "M22", label: "BuyerTrust: 'trusted payment provider'", file: "components/landing/BuyerTrust.tsx", from: "You pay by card on a separate checkout page", to: "Payments are processed by a trusted payment provider" },
  { id: "M23", label: "SellerCta: 'Payouts straight to your bank'", file: "components/landing/SellerCta.tsx", from: "Payout requests coming soon", to: "Payouts straight to your bank" },
  { id: "M24", label: "Faq: 'handled through our payments partner'", file: "components/landing/Faq.tsx", from: "Payout requests and processing are coming soon.", to: "Payouts are handled through our payments partner." },
  { id: "M25", label: "template literal with holes: `Files are ${'delivered'} instantly`", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "{`Files are ${x} instantly`}." },
  { id: "M26", label: 'array join: {["down","load"].join("")}', file: "components/landing/Hero.tsx", from: HERO_TAIL, to: '{["down", "load"].join("")}.' },
  { id: "M27", label: "Hero badge 'Age-verified sellers'", file: "components/landing/Hero.tsx", from: "Verification required to publish", to: "Age-verified sellers" },
  { id: "M28", label: "BuyerTrust: 'private to the creator who shares it' (FE-19)", file: "components/landing/BuyerTrust.tsx", from: "Each payment link is long and unguessable", to: "Each payment link is private to the creator who shares it" },
  { id: "M29", label: "'photos and videos' while VIDEO_UPLOAD is false (Hero)", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "sell photos and videos." },
  { id: "M30", label: "JSX attribute title=\"Instant download\"", file: "components/landing/PaymentLinkMock.tsx", from: '<Badge tone="success">', to: '<Badge tone="success" title="Instant download">' },
  { id: "M31", label: "manifest.ts description with 'Download instantly'", file: "src/app/manifest.ts", from: "Sell your files with a simple payment link.", to: "Download instantly." },
  { id: "M32", label: "'unlocks after purchase' (buyer page)", file: "src/app/u/[linkId]/page.tsx", from: "Access to the full files is shared once your payment is confirmed.", to: "The full files unlock after purchase." },
  { id: "M33", label: "hosted mock page text promise (src/app/pay)", file: "src/app/pay/mock/[sessionId]/MockCheckoutForm.tsx", from: "Test card number", to: "Test card number (files are emailed right away)" },
  { id: "M34", label: "dashboard payout hint over-promises (Payouts straight to your bank)", file: "src/app/dashboard/page.tsx", from: "Payout requests are coming soon", to: "Payouts straight to your bank" },
  { id: "M35", label: "uppercase / mixed case 'INSTANT DOWNLOAD'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "INSTANT DOWNLOAD." },
];

describe("copy guard self-test: every injected promise is caught", () => {
  it("has at least 18 mutations (QA's M1..M18) plus evasion variants", () => { expect(MUTATIONS.length).toBeGreaterThanOrEqual(18); });
  it("the unmutated sources are clean (so a catch is caused by the mutation)", () => {
    for (const file of new Set(MUTATIONS.map((m) => m.file))) expect(violationsOf(file, read(file)), file).toEqual([]);
  });
  for (const m of MUTATIONS) {
    it(`${m.id} ${m.label}`, () => {
      const src = read(m.file);
      const mutated = typeof m.from === "string" ? src.replace(m.from, m.to) : src.replace(m.from, m.to);
      expect(mutated, `mutation ${m.id} did not apply to ${m.file}`).not.toBe(src);
      const v = violationsOf(m.file, mutated);
      expect(v.length, `${m.id} slipped through the guard`).toBeGreaterThan(0);
    });
  }
  it("a promise in a brand-new frontend file is caught too", () => {
    expect(violationsOf("components/landing/NewSection.tsx", 'export const A = () => <p>Your files arrive instantly.</p>;').length).toBeGreaterThan(0);
    expect(violationsOf("components/landing/NewSection.tsx", 'export const A = () => <p>Share your link anywhere.</p>;')).toEqual([]);
  });
  it("identifier names and comments alone never trigger (no false alarms from DownloadIcon / comments)", () => {
    expect(scanSource("components/x.tsx", 'import { DownloadIcon } from "./Icons";\n// download instantly\n/* receipt */\nexport const a = { icon: DownloadIcon, title: "Secure checkout" };')).toEqual([]);
  });
});
