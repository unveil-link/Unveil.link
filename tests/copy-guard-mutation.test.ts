import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractUnits, readFlags, scanSource, type Hit } from "./helpers/copy-scan";
import { featurePinProblems, violations } from "./helpers/guard";
import { QA_MUTATIONS } from "./helpers/qa-mutations";
import { ALLOW, BACKEND_BASELINE } from "./copy-guard.allowlist";

/**
 * Self-test of the copy guard (FE-18 / FE-18b): inject bad edits into IN-MEMORY copies of the real sources (or brand-new files) and assert the scanner,
 * the exact-string allowlist (with counts) and the flag checks flag every one. Nothing on disk is modified.
 *  - M1..M18 mirror QA's qa/scripts/qa-fe5-guard-mutation.sh (round 5); M19..M35 are our own evasion tricks (entities, zero-width, spacing, concat, join ...).
 *  - X1.. are paraphrase / structural / flag-regression cases added with FE-18b (delivery, money, trust, support, review, FE-20/21 regressions).
 *  - QA_MUTATIONS (tests/helpers/qa-mutations.ts) are QA's 48 round-6 mutations from qa/scripts/qa-fe6-guard-mutation2.mjs, ported verbatim: every
 *    "must-catch" must be caught, every "should-pass" (comment / type-only) must stay green, and the loophole probes are asserted too.
 * If one of these starts failing, the guard has a hole.
 */
const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const isBackend = (f: string) => f.startsWith("src/server/") || f.startsWith("src/app/api/");
const FLAGS = readFlags((rel) => (existsSync(join(ROOT, rel)) ? read(rel) : null));
function walkTs(rel: string, out: string[] = []): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) walkTs(`${rel}/${e.name}`, out);
    else if (/\.tsx?$/.test(e.name)) out.push(`${rel}/${e.name}`);
  }
  return out;
}
const BACKEND_FILES = [...walkTs("src/server"), ...walkTs("src/app/api")];
function violationsOf(file: string, src: string, flags = FLAGS): Hit[] {
  return violations(scanSource(file, src, flags), isBackend(file) ? BACKEND_BASELINE : ALLOW);
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


type Case = { id: string; label: string; file: string; pre?: string; from?: string | RegExp; to?: string; content?: string; kind: "must-catch" | "should-pass" | "loophole" };
const X: Case[] = [
  // paraphrases (semantic rule groups)
  { id: "X1", label: "'We\u2019ll send you the link'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "we\u2019ll send you the link.", kind: "must-catch" },
  { id: "X2", label: "'you will get a copy of the files in your mailbox'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "you will get a copy of the files in your mailbox.", kind: "must-catch" },
  { id: "X3", label: "'as soon as you pay, the files open'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "as soon as you pay, the files open.", kind: "must-catch" },
  { id: "X4", label: "'unlocks after payment'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "it unlocks after payment.", kind: "must-catch" },
  { id: "X5", label: "'Files are sent automatically'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "files are sent automatically.", kind: "must-catch" },
  { id: "X6", label: "'Weekly payouts to your bank account'", file: "components/landing/Faq.tsx", from: "Payout requests and processing are coming soon.", to: "Weekly payouts to your bank account.", kind: "must-catch" },
  { id: "X7", label: "'Withdraw instantly'", file: "components/landing/Faq.tsx", from: "Payout requests and processing are coming soon.", to: "Withdraw your balance any time, same-day.", kind: "must-catch" },
  { id: "X8", label: "'Guaranteed earnings'", file: "components/landing/SellerCta.tsx", from: "Payout requests coming soon", to: "Guaranteed earnings", kind: "must-catch" },
  { id: "X9", label: "'bank-level security' / 'PCI compliant' / 'certified'", file: "components/landing/BuyerTrust.tsx", from: "and Unveil does not store card numbers.", to: "with bank-level security, PCI compliant and certified.", kind: "must-catch" },
  { id: "X10", label: "'Contact support' while /contact is a placeholder", file: "components/dashboard/types.ts", from: "Verification wasn\u2019t completed.", to: "Verification failed. Contact support.", kind: "must-catch" },
  { id: "X11", label: "'A person is reviewing your verification'", file: "components/dashboard/types.ts", from: "Your verification is marked for review.", to: "A person is reviewing your documents.", kind: "must-catch" },
  { id: "X12", label: "'Our team will review it shortly'", file: "components/dashboard/types.ts", from: "Your verification is marked for review.", to: "Our team will review it shortly.", kind: "must-catch" },
  // FE-20 regressions
  { id: "X14", label: "FE-20: dropzone hint advertises MP4 again", file: "lib/upload-limits.ts", from: ': "JPG, PNG or WebP";', to: ': "JPG, PNG, WebP or MP4";', kind: "must-catch" },
  { id: "X15", label: "FE-20: FileDropzone hard-codes video/mp4 into accept", file: "components/dashboard/FileDropzone.tsx", from: "const accept = acceptAttr(limits);", to: 'const accept = [acceptAttr(limits), "video/mp4", ".mp4"].join(",");', kind: "must-catch" },
  { id: "X16", label: "FE-20: contradictory 'MP4 coming soon' line is back", file: "components/dashboard/NewDropFlow.tsx", from: "{videoNote(limits)}", to: "MP4 video up to 500 MB is coming soon.", kind: "must-catch" },
  // structural
  { id: "X17", label: "JSX run across three nodes: Down<b>lo</b>ad", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "Down<b>lo</b>ad now.", kind: "must-catch" },
  { id: "X18", label: "constant folding through a named const: const a='In'; a + 'stantly'", file: "components/landing/Hero.tsx", from: "export function Hero", to: 'const _a = "In";\nconst _b = _a + "stantly";\nexport function Hero', kind: "must-catch" },
  { id: "X19", label: "unresolvable dynamic string in user-visible position (fails closed)", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "{parts.map((c) => c.trim()).join(\"\")}.", kind: "must-catch" },
  { id: "X20", label: "Greek homoglyphs 'ιnstantly' / 'ο' in download", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "\u03B9nstantly, d\u03BFwnload.", kind: "must-catch" },
  { id: "X21", label: "full-width letters 'Ｉｎｓｔａｎｔ ｄｏｗｎｌｏａｄ'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "\uFF29\uFF4E\uFF53\uFF54\uFF41\uFF4E\uFF54 \uFF44\uFF4F\uFF57\uFF4E\uFF4C\uFF4F\uFF41\uFF44.", kind: "must-catch" },
  { id: "X22", label: "German 'sofortiger Download' / 'Quittung'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "sofortiger Download mit Quittung.", kind: "must-catch" },
  { id: "X23", label: "Spanish 'recibo' / 'inmediatamente'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "recibo inmediatamente.", kind: "must-catch" },
  { id: "X24", label: "French 'reçu' / 'instantané'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "reçu instantané.", kind: "must-catch" },
  { id: "X25", label: "markdown page shown to users with a promise", file: "src/app/legal/terms.md", content: "# Terms\n\nYour files arrive instantly.", kind: "must-catch" },
  { id: "X26", label: "webmanifest description promise", file: "public/site.webmanifest", content: '{"name":"Unveil","description":"Get paid weekly, straight to your bank"}', kind: "must-catch" },
  { id: "X27", label: "CSS content with split promise", file: "src/app/globals.css", from: '@import "tailwindcss";', to: '@import "tailwindcss";\n.a::before { content: "Receipt " "emailed"; }', kind: "must-catch" },
  { id: "X28", label: "next.config.ts header value promise (JSON-ish)", file: "next.config.ts", from: "const nextConfig", to: 'const promo = { headers: [{ key: "X-Promo", value: "Download instantly" }] };\nconst nextConfig', kind: "must-catch" },
  { id: "X29", label: "svg <title> promise", file: "public/logo.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><title>Instant download</title></svg>', kind: "must-catch" },
  { id: "X30", label: "neutral new JSX passes (no false alarm)", file: "components/landing/NewSection.tsx", content: 'export const A = () => <p>Share your link anywhere. <b>Stay</b>in control.</p>;', kind: "should-pass" },
  { id: "X31", label: "plain Hero with the CTA 'Create your account' passes", file: "components/landing/Hero.tsx", from: "Create your account", to: "Create your account", kind: "should-pass" },

  // FE-18c/d: money claims, hard-coded payout numbers, folding gaps, scan scope, honest-copy carve-outs
  { id: "X32", label: "'Keep 90% of every sale' (the real fees are configurable)", file: "components/landing/Faq.tsx", from: "Payout requests and processing are coming soon.", to: "You keep 90% of every sale.", kind: "must-catch" },
  { id: "X33", label: "'Zero fees' / 'No fees, ever'", file: "components/landing/SellerCta.tsx", from: "Payout requests coming soon", to: "No fees, ever", kind: "must-catch" },
  { id: "X34", label: "'Funds arrive in 2 business days'", file: "components/landing/Faq.tsx", from: "Payout requests and processing are coming soon.", to: "Funds arrive in 2 business days.", kind: "must-catch" },
  { id: "X35", label: "hold days hard-coded in the FAQ ('14-day hold') instead of PAYOUT_HOLD_DAYS", file: "components/landing/Faq.tsx", from: "${PAYOUT_HOLD_DAYS}-day hold", to: "14-day hold", kind: "must-catch" },
  { id: "X36", label: "minimum payout hard-coded in the FAQ ('payouts start at $10')", file: "components/landing/Faq.tsx", from: "payouts start at $${MIN_PAYOUT_USD}", to: "payouts start at $10", kind: "must-catch" },
  { id: "X37", pre: 'const T = { a: "In", b: "stantly" };', label: "object property lookup: T.a + T.b", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "{T.a + T.b}.", kind: "must-catch" },
  { id: "X38", pre: 'const [da, db] = ["In", "stantly"];', label: "array destructuring: const [a, b] = [...]", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "{da + db}.", kind: "must-catch" },
  { id: "X39", pre: 'let ls = "In"; ls += "stantly";', label: "let s = 'In'; s += 'stantly'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "{ls}.", kind: "must-catch" },
  { id: "X40", label: ".replace(/x/g, '') spelling", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: '{"Ixnxstxantxly".replace(/x/g, "")}.', kind: "must-catch" },
  { id: "X41", pre: 'const hh = () => "In";', label: "zero-argument helper: const h = () => 'In'; h() + 'stantly'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: '{hh() + "stantly"}.', kind: "must-catch" },
  { id: "X42", label: "[...'yltnatsni'].reverse().join('')", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: '{[..."yltnatsni"].reverse().join("")}.', kind: "must-catch" },
  { id: "X43", label: "env-driven flag: VIDEO_UPLOAD = process.env.X === '1' (no longer provably false)", file: "lib/features.ts", from: "export const VIDEO_UPLOAD = false;", to: 'export const VIDEO_UPLOAD = process.env.NEXT_PUBLIC_VIDEO === "1";', kind: "must-catch" },
  { id: "X44", label: "new top-level folder content/copy.ts (scan by default)", file: "content/copy.ts", content: 'export const PROMO = "Instant download, receipt by email";', kind: "must-catch" },
  { id: "X45", label: "new top-level messages/en.json", file: "messages/en.json", content: '{"hero":"Instant download"}', kind: "must-catch" },
  { id: "X46", label: "mail template .hbs under src/server", file: "src/server/mail/receipt.hbs", content: "<p>Your receipt and download link are below.</p>", kind: "must-catch" },
  { id: "X47", label: "public/promo.xml", file: "public/promo.xml", content: "<feed><entry><summary>Instant download</summary></entry></feed>", kind: "must-catch" },
  { id: "X48", label: "SVG text split across <tspan>", file: "public/promo2.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><text>In<tspan>stant</tspan>ly</text></svg>', kind: "must-catch" },
  { id: "X49", label: "CSS adjacent strings content: 'In' 'stantly'", file: "src/app/globals.css", from: '@import "tailwindcss";', to: '@import "tailwindcss";\n.x::after { content: "In" "stantly"; }', kind: "must-catch" },
  { id: "X50", label: "speed claim 'Buyers check out in seconds' (FE-24) is flagged by the claim rules", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "buyers get access within minutes.", kind: "must-catch" },
  { id: "X51", label: "'Lifetime access' / 'zero wait'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "lifetime access, zero wait.", kind: "must-catch" },
  { id: "X52", label: "'Email help@unveil.link' (no such mailbox)", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "Questions? Email help@unveil.link.", kind: "must-catch" },
  { id: "X53", label: "Chinese 付款后立即下载", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "付款后立即下载。", kind: "must-catch" },
  { id: "X54", label: "symbol leet '!nstant'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: "!nstant access.", kind: "must-catch" },
  // honest copy QA listed as false positives: must stay green WITHOUT an allowlist entry (rule-level carve-outs, one clause only)
  { id: "X55", label: "honest: 'Your link is ready to share.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: HERO_TAIL + " Your link is ready to share.", kind: "should-pass" },
  { id: "X56", label: "honest: 'Your reset link expires in 60 seconds.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: HERO_TAIL + " Your reset link expires in 60 seconds.", kind: "should-pass" },
  { id: "X57", label: "honest: 'Receipts are not available yet.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: HERO_TAIL + " Receipts are not available yet.", kind: "should-pass" },
  { id: "X58", label: "honest: 'Download your sales as CSV'", file: "components/landing/Faq.tsx", from: "Your dashboard shows the exact breakdown.", to: "Your dashboard shows the exact breakdown. Download your sales as CSV.", kind: "should-pass" },
  { id: "X59", label: "carve-out must not hide a continued promise: 'Receipts are not available yet, but we email them instantly.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: HERO_TAIL + " Receipts are not available yet, but we email them instantly.", kind: "must-catch" },
  { id: "X60", label: "carve-out must not hide a sibling sentence: 'Receipts are not available yet. We email a receipt.'", file: "components/landing/Hero.tsx", from: HERO_TAIL, to: HERO_TAIL + " Receipts are not available yet. We email a receipt.", kind: "must-catch" },
];

type Spec = Case;
const all: Spec[] = [...X, ...QA_MUTATIONS];

/** A mutation is "caught" when the guard would fail: forbidden hits outside the allowlist, or (flag flipped) VIDEO_UPLOAD=true without backend video support. */
function caught(m: Spec): { applied: boolean; caught: boolean; detail: string } {
  const orig = existsSync(join(ROOT, m.file)) ? read(m.file) : null;
  let mutated: string;
  if (m.content !== undefined) mutated = m.content;
  else {
    if (orig === null || !(typeof m.from === "string" ? orig.includes(m.from) : m.from!.test(orig))) return { applied: false, caught: false, detail: `anchor not found in ${m.file}` };
    mutated = orig.replace(m.from!, m.to!);
    if (m.pre) mutated = mutated.replace("export function Hero", `${m.pre}\nexport function Hero`);
    if (mutated === orig && m.kind !== "should-pass") return { applied: false, caught: false, detail: "no-op" };
  }
  const flags = readFlags((rel) => (rel === m.file ? mutated : existsSync(join(ROOT, rel)) ? read(rel) : null));
  const v = violationsOf(m.file, mutated, flags);
  if (v.length) return { applied: true, caught: true, detail: v.map((h) => `[${h.rule}] ${h.text}`).join(" | ").slice(0, 160) };
  if (m.file === "lib/features.ts" && flags.videoUpload) {
    const back = BACKEND_FILES.some((f) => extractUnits(f, read(f)).some((u) => /video\/mp4/i.test(u.text)));
    if (!back) return { applied: true, caught: true, detail: "VIDEO_UPLOAD=true but the backend has no video/mp4 handling" };
  }
  if (m.file === "lib/features.ts") {
    const pins = featurePinProblems(mutated);
    if (pins.length) return { applied: true, caught: true, detail: pins.join("; ") };
  }
  return { applied: true, caught: false, detail: "" };
}

describe("copy guard self-test: every injected promise is caught", () => {
  it("has QA's 18 + 48 mutations plus our own", () => { expect(MUTATIONS.length).toBe(35); expect(QA_MUTATIONS.length).toBe(48); expect(X.length).toBeGreaterThanOrEqual(30); });
  it("the unmutated sources are clean (so a catch is caused by the mutation)", () => {
    for (const file of new Set([...MUTATIONS, ...all].filter((m) => !("content" in m && m.content !== undefined)).map((m) => m.file))) {
      if (existsSync(join(ROOT, file))) expect(violationsOf(file, read(file), FLAGS), file).toEqual([]);
    }
  });
  for (const m of MUTATIONS) {
    it(`${m.id} ${m.label}`, () => {
      const src = read(m.file);
      const mutated = src.replace(m.from, m.to);
      expect(mutated, `mutation ${m.id} did not apply to ${m.file}`).not.toBe(src);
      const v = violationsOf(m.file, mutated, FLAGS);
      expect(v.length, `${m.id} slipped through the guard`).toBeGreaterThan(0);
    });
  }
  for (const m of all) {
    it(`${m.id} [${m.kind}] ${m.label}`, () => {
      const r = caught(m);
      expect(r.applied, `${m.id}: ${r.detail}`).toBe(true);
      if (m.kind === "should-pass") expect(r.caught, `${m.id} false alarm: ${r.detail}`).toBe(false);
      else expect(r.caught, `${m.id} slipped through the guard`).toBe(true);
    });
  }
  it("a promise in a brand-new frontend file is caught too", () => {
    expect(violationsOf("components/landing/NewSection.tsx", 'export const A = () => <p>Your files arrive instantly.</p>;', FLAGS).length).toBeGreaterThan(0);
    expect(violationsOf("components/landing/NewSection.tsx", 'export const A = () => <p>Share your link anywhere.</p>;', FLAGS)).toEqual([]);
  });
  it("identifier names and comments alone never trigger (no false alarms from DownloadIcon / comments)", () => {
    expect(scanSource("components/x.tsx", 'import { DownloadIcon } from "./Icons";\n// download instantly\n/* receipt */\nexport const a = { icon: DownloadIcon, title: "Secure checkout" };', FLAGS)).toEqual([]);
  });
  it("flipping VIDEO_UPLOAD to true re-allows video wording but needs backend support (separate test in copy-guard.test.ts)", () => {
    const on = readFlags((rel) => (rel === "lib/features.ts" ? "export const VIDEO_UPLOAD = true;" : null));
    expect(on.videoUpload).toBe(true);
    expect(scanSource("components/landing/Hero.tsx", "export const A = () => <p>Upload MP4 clips and photos.</p>;", on)).toEqual([]);
    expect(scanSource("components/landing/Hero.tsx", "export const A = () => <p>Upload MP4 clips and photos.</p>;", { ...on, videoUpload: false }).length).toBeGreaterThan(0);
  });
});
