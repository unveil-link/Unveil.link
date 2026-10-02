// FE-18b round 7: 50+ NEW mutations of tests/copy-guard.test.ts (the real test, run on a scratch copy; the worktree is never touched).
// usage: WT=/workspace/qa-fe8 node qa-fe8-guard-mutation3.mjs [idFilterRegex]
// Each mutation: edits = list of {file, from, to} (replace) | {file, content} (create/overwrite) | {file, rename} | {file, remove}. kind: promise (a real false/unverifiable claim: CAUGHT is good, BYPASS is a gap),
// fp (legit copy: PASS is good, FAIL = false positive), should-pass (not user-facing), process (needs a human decision; informational).
import fs from "node:fs"; import path from "node:path"; import { spawnSync, execSync } from "node:child_process";
const WT = process.env.WT; const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; const S = fs.mkdtempSync("/tmp/mut.fe8c.");
execSync(`cd ${WT} && cp -r tests components lib src public vitest.config.mts tsconfig.json package.json next.config.ts docs ${S}/ 2>/dev/null; ln -s ${WT}/node_modules ${S}/node_modules`);
const run = () => { const r = spawnSync("npx", ["vitest", "run", "tests/copy-guard.test.ts"], { cwd: S, encoding: "utf8" }); return { ok: r.status === 0, out: (r.stdout + r.stderr) }; };
const HERO = "access to the files is shared once payment is confirmed.", HF = "components/landing/Hero.tsx", FAQ = "components/landing/Faq.tsx";
const M = []; const m = (id, kind, label, edits) => M.push({ id, kind, label, edits });
const hero = (id, kind, label, to) => m(id, kind, label, [{ file: HF, from: HERO, to }]);
const jsx = (id, kind, label, to) => m(id, kind, label, [{ file: HF, from: HERO, to: HERO + " " + to }]);
// ---- A. paraphrased delivery / speed / receipt promises (rule-group gaps)
jsx("P1", "promise", "'Buyers get the files as the payment clears'", "Buyers get the files as the payment clears.");
jsx("P2", "promise", "'Your files open when checkout finishes'", "Your files open when checkout finishes.");
jsx("P3", "promise", "'Zero wait for buyers'", "Zero wait for buyers.");
jsx("P4", "promise", "'Buyers get access within minutes'", "Buyers get access within minutes.");
jsx("P5", "promise", "'Access is granted automatically after payment'", "Access is granted automatically after payment.");
jsx("P6", "promise", "'You’ll be sent the originals'", "You’ll be sent the originals.");
jsx("P7", "promise", "'Lifetime access to everything you buy'", "Lifetime access to everything you buy.");
jsx("P8", "promise", "'Your files stay available for 30 days'", "Your files stay available for 30 days.");
jsx("P9", "promise", "'Re-access your purchase any time from your account'", "Re-access your purchase any time from your account.");
jsx("P10", "promise", "'Your order summary is on its way'", "Your order summary is on its way.");
// ---- B. money / payout / fee claims
m("P11", "promise", "'Funds arrive in 2 business days' (payout speed)", [{ file: FAQ, from: "Payout requests and processing are coming soon.", to: "Funds arrive in 2 business days." }]);
m("P12", "promise", "'Keep 90% of every sale' (contradicts real 10% + 12% fees)", [{ file: FAQ, from: "you keep most of every sale", to: "you keep 90% of every sale" }]);
m("P13", "promise", "'Zero fees' / 'No fees, ever'", [{ file: FAQ, from: "Each sale carries a platform fee and card-processing fees", to: "There are zero fees, ever" }]);
m("P14", "promise", "'We pay creators 48 hours after each sale'", [{ file: FAQ, from: "Payout requests and processing are coming soon.", to: "We pay creators 48 hours after each sale." }]);
m("P15", "promise", "FAQ hold hard-coded '14-day hold' instead of the pinned constant", [{ file: FAQ, from: "${PAYOUT_HOLD_DAYS}-day hold", to: "14-day hold" }]);
m("P16", "promise", "FAQ minimum hard-coded '$10' instead of the pinned constant", [{ file: FAQ, from: "payouts start at $${MIN_PAYOUT_USD}", to: "payouts start at $10" }]);
// ---- C. support / review / trust / verification claims
jsx("P17", "promise", "'Questions? Email help@unveil.link' (no such mailbox; /contact is a placeholder)", "Questions? Email help@unveil.link.");
jsx("P18", "promise", "'24/7 support for sellers'", "24/7 support for sellers.");
jsx("P19", "promise", "'Every drop is manually reviewed before it goes live'", "Every drop is manually reviewed before it goes live.");
jsx("P20", "promise", "'Our moderation team checks every link'", "Our moderation team checks every link.");
jsx("P21", "promise", "'Secured with 256-bit SSL'", "Secured with 256-bit SSL.");
jsx("P22", "promise", "'Every creator is ID-checked'", "Every creator is ID-checked.");
jsx("P23", "promise", "'Get verified in minutes'", "Get verified in minutes.");
// ---- D. other languages / scripts
hero("L1", "promise", "Spanish: 'Recibes tus archivos al momento'", "Recibes tus archivos al momento.");
hero("L2", "promise", "French: 'accès dès le paiement' (instant access, no listed keyword)", "accès dès le paiement.");
hero("L3", "promise", "Chinese: '付款后立即下载' (instant download)", "付款后立即下载。");
hero("L4", "promise", "Portuguese: 'receba tudo na hora'", "receba tudo na hora.");
// ---- E. extractor evasion (constant folding / structure)
const dummy = (extra, expr) => [{ file: HF, from: "export function Hero", to: extra + "\nexport function Hero" }, { file: HF, from: HERO, to: expr }];
m("S1", "promise", "helper call across boundary: const a = () => \"In\"; {a() + \"stantly\"}", dummy('const a = () => "In";', '{a() + "stantly"}.'));
m("S2", "promise", "ternary parts: {(cond ? \"Inst\" : \"Inst\") + \"antly\"}", dummy("const cond = SELLABLE.length > 1;", '{(cond ? "Inst" : "Inst") + "antly"}.'));
m("S3", "promise", "object property lookup: T.a + T.b", dummy('const T = { a: "In", b: "stantly" };', "{T.a + T.b}."));
m("S4", "promise", "array destructuring: const [a, b] = [\"In\",\"stantly\"]", dummy('const [a1, b1] = ["In", "stantly"];', "{a1 + b1}."));
m("S5", "promise", "let + += : let s = \"In\"; s += \"stantly\"", dummy('let s = "In"; s += "stantly";', "{s}."));
m("S6", "promise", "prop composition: <Frag a=\"In\" /> renders {a}stantly", [{ file: HF, from: "export function Hero", to: 'const Frag = ({ a }: { a: string }) => <b>{a}stantly</b>;\nexport function Hero' }, { file: HF, from: HERO, to: '<Frag a="In" />.' }]);
m("S7", "promise", "regex replace: \"Ixnxstxantxly\".replace(/x/g, \"\")", [{ file: HF, from: HERO, to: '{"Ixnxstxantxly".replace(/x/g, "")}.' }]);
m("S8", "promise", "spread reverse: [...\"yltnatsni\"].reverse().join(\"\")", [{ file: HF, from: HERO, to: '{[..."yltnatsni"].reverse().join("")}.' }]);
m("S9", "promise", "Array.from reverse: Array.from(\"yltnatsni\").reverse().join(\"\")", [{ file: HF, from: HERO, to: '{Array.from("yltnatsni").reverse().join("")}.' }]);
m("S10", "promise", "bidi-override CSS: <span style={{unicodeBidi:'bidi-override',direction:'rtl'}}>yltnatsni</span>", [{ file: HF, from: HERO, to: "<span style={{ unicodeBidi: \"bidi-override\", direction: \"rtl\" }}>yltnatsni</span>." }]);
m("S11", "promise", "unmapped homoglyph: 'ɪnstant' (U+026A)", [{ file: HF, from: HERO, to: "\u026Anstant." }]);
m("S12", "promise", "symbol-leet: '!nstant' (! for i)", [{ file: HF, from: HERO, to: "!nstant." }]);
m("S13", "promise", "JSON parts joined at runtime: {parts.join(\"\")} from a JSON module", [{ file: "public/promo-parts.json", content: '{"parts":["In","stantly"]}' }, { file: HF, from: "export function Hero", to: 'import promo from "../../public/promo-parts.json";\nexport function Hero' }, { file: HF, from: HERO, to: "{promo.parts.join(\"\")}." }]);
m("S14", "promise", "aria-label + alt + placeholder carry the promise", [{ file: HF, from: HERO, to: '<img alt="Instant download" src="/x.png" /><span aria-label="receipt by email" /><input placeholder="your files arrive in your inbox" />.' }]);
m("S15", "promise", "String.raw tagged template + \\u escapes: 'Inst\\u0061nt'", [{ file: HF, from: HERO, to: "{String.raw`Instant download`} {\"Inst\\u0061nt\"}." }]);
m("S16", "promise", "NBSP/braille-blank/tag-char inside word: 'In\\u2800stant'", [{ file: HF, from: HERO, to: "In\u2800stant dow\u{E0020}nload." }]);
m("S17", "promise", "dynamic import of a NEW module under src/ (scanned)", [{ file: "src/app/extra-copy.ts", content: 'export const line = "Instant download";' }, { file: HF, from: HERO, to: HERO + " {String(typeof import(\"@/app/extra-copy\"))}" }]);
// ---- F. places / file types the guard may not scan
m("F1", "promise", "new top-level folder messages/en.json imported by Hero (outside SCAN_DIRS)", [{ file: "messages/en.json", content: '{"hero":"Instant download"}' }, { file: HF, from: "export function Hero", to: 'import msg from "../../messages/en.json";\nexport function Hero' }, { file: HF, from: HERO, to: "{msg.hero}." }]);
m("F2", "promise", "new top-level content/copy.ts (outside SCAN_DIRS)", [{ file: "content/copy.ts", content: 'export const PROMO = "Instant download, receipt by email";' }]);
m("F3", "promise", "public/promo.xml (extension not scanned)", [{ file: "public/promo.xml", content: '<feed><entry><summary>Instant download</summary></entry></feed>' }]);
m("F4", "promise", "mail template as .mjml/.hbs under src/server (extension not scanned)", [{ file: "src/server/mail/receipt.hbs", content: "<p>Your receipt and download link are below.</p>" }]);
m("F5", "promise", "public/promo.txt (scanned as text)", [{ file: "public/llms.txt", content: "Unveil: instant download after payment." }]);
m("F6", "promise", "CSS content with adjacent strings: content: \"In\" \"stantly\"", [{ file: "src/app/globals.css", from: '@import "tailwindcss";', to: '@import "tailwindcss";\n.x::after { content: "In" "stantly"; }' }]);
m("F7", "promise", "SVG text split across <tspan>: In<tspan>stant</tspan>ly", [{ file: "public/promo2.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><text>In<tspan>stant</tspan>ly</text></svg>' }]);
m("F8", "promise", "package.json-style / webmanifest description promise", [{ file: "public/site.webmanifest", content: '{"name":"Unveil","description":"Instant downloads for every buyer"}' }]);
m("F9", "promise", "new API route error string split across concat (ratchet)", [{ file: "src/app/api/ping/route.ts", content: 'export const GET = () => Response.json({ error: "Your rece" + "ipt is on its way" });' }]);
m("F10", "promise", "next.config.ts headers() with a promise-bearing header value", [{ file: "next.config.ts", from: "const nextConfig", to: 'export const _promo = { env: { PROMO: "Instant download" } };\nconst nextConfig' }]);
// ---- G. allowlist / ratchet / flag loopholes
m("A1", "promise", "rename an allowlisted file (DownloadPanel -> PostPurchase.tsx)", [{ file: "components/buyer/DownloadPanel.tsx", rename: "components/buyer/PostPurchase.tsx" }]);
m("A2", "promise", "copy an allowlisted file to a new name and keep the old one", [{ file: "components/buyer/DownloadPanel.tsx", copy: "components/buyer/DownloadPanel2.tsx" }]);
m("A3", "promise", "append a promise sentence INSIDE an allowlisted unit (TrustPoints)", [{ file: "components/buyer/TrustPoints.tsx", from: "Delivery options are coming soon.", to: "Delivery options are coming soon. Your receipt is emailed." }]);
m("A4", "promise", "allowlisted sentence reused verbatim in a second place of the SAME file (count)", [{ file: "components/buyer/TrustPoints.tsx", from: "Delivery options are coming soon.", to: "Delivery options are coming soon.\"} /><p>{\"Access to the files is shared once your payment is confirmed. Delivery options are coming soon." }]);
m("A6", "process", "edit the allowlist itself: add an exact-string entry for a promise literal (no CODEOWNERS / review gate in the repo)", [{ file: HF, from: HERO, to: HERO + ' {"Instant download."}' }, { file: "tests/copy-guard.allowlist.ts", from: "export const ALLOW: Allow[] = [", to: 'export const ALLOW: Allow[] = [ { file: "components/landing/Hero.tsx", text: "Instant download.", reason: "reviewed and fine, honest" },' }]);
m("A7", "promise", "flag via env: VIDEO_UPLOAD = process.env.NEXT_PUBLIC_VIDEO === \"1\" (guard reads `= true` only)", [{ file: "lib/features.ts", from: "export const VIDEO_UPLOAD = false;", to: 'export const VIDEO_UPLOAD = process.env.NEXT_PUBLIC_VIDEO === "1";' }]);
m("A8", "promise", "flag flip true + dummy backend string 'video/mp4' (satisfies the backend-support test)", [{ file: "lib/features.ts", from: "export const VIDEO_UPLOAD = false;", to: "export const VIDEO_UPLOAD = true;" }, { file: "src/server/services/dummy.ts", content: 'export const X = "video/mp4";' }]);
m("A9", "promise", "PAYOUT constants pinned but spelled differently: `export const PAYOUT_HOLD_DAYS: number = 30`", [{ file: "lib/features.ts", from: "export const PAYOUT_HOLD_DAYS = 7;", to: "export const PAYOUT_HOLD_DAYS: number = 30;" }]);
m("A10", "promise", "contact page becomes real but guard flag still 'placeholder' => rule would still ban; reverse: copy says 'contact support' while /contact is a placeholder", [{ file: HF, from: HERO, to: HERO + " Contact support if anything goes wrong." }]);
// ---- H. false-positive probes (legitimate copy; PASS is correct, FAIL = false alarm that blocks honest copy)
m("FP1", "fp", "legit: 'Your link is ready to share.' (seller-facing, after creating a drop)", [{ file: HF, from: HERO, to: HERO + " Your link is ready to share." }]);
m("FP2", "fp", "legit: 'Your reset link expires in 60 seconds.'", [{ file: HF, from: HERO, to: HERO + " Your reset link expires in 60 seconds." }]);
m("FP3", "fp", "legit honest negative: 'Receipts are not available yet.'", [{ file: HF, from: HERO, to: HERO + " Receipts are not available yet." }]);
m("FP4", "fp", "legit: 'Download your sales as CSV' (seller export)", [{ file: FAQ, from: "Your dashboard shows the exact breakdown.", to: "Your dashboard shows the exact breakdown. Download your sales as CSV." }]);
m("FP5", "fp", "legit legal copy on /terms: 'You may withdraw your consent at any time.'", [{ file: "src/app/terms/page.tsx", from: "export default function Page", to: 'const LEGAL = "You may withdraw your consent at any time.";\nexport default function Page' }]);
m("FP6", "fp", "legit privacy copy: 'We encrypt passwords with bcrypt.'", [{ file: "src/app/privacy/page.tsx", from: "export default function Page", to: 'const LEGAL = "We encrypt passwords with bcrypt.";\nexport default function Page' }]);
m("FP7", "fp", "legit: 'Publish in one click.' / 'Supports JPG, PNG and WebP.'", [{ file: HF, from: HERO, to: HERO + " Publish in one click. Supports JPG, PNG and WebP." }]);
m("FP8", "fp", "legit honest: 'Photos only for now: no video.'", [{ file: HF, from: HERO, to: HERO + " Photos only for now: no video." }]);
// ---- I. not user-facing (should pass)
m("C1", "should-pass", "// comment with a promise", [{ file: HF, from: "export function Hero", to: "// Instant download, receipt by email\nexport function Hero" }]);
m("C2", "should-pass", "/* block comment */ with a promise inside JSX attribute list", [{ file: HF, from: "export function Hero", to: "/* Instant download */\nexport function Hero" }]);
m("C3", "should-pass", "identifier names: const InstantDownloadReceipt = 1", [{ file: HF, from: "export function Hero", to: "const InstantDownloadReceipt = 1; void InstantDownloadReceipt;\nexport function Hero" }]);
m("FP9", "fp", "developer-only string (console.log(\"Instant download\") in lib): scanned, flagged (conservative)", [{ file: "lib/format.ts", from: "export function formatDuration", to: 'export const _dev = () => console.log("Instant download");\nexport function formatDuration' }]);

const base = run(); console.log(`baseline (unmodified copy): guard ${base.ok ? "PASS" : "FAIL"}`);
const rows = []; let caught = 0, byp = 0, fpFail = 0, fpOk = 0, skipped = 0;
for (const x of M) {
  if (ONLY && !ONLY.test(x.id)) continue;
  const undo = []; let applied = true;
  for (const e of x.edits) {
    const f = path.join(S, e.file);
    if (e.rename) { if (!fs.existsSync(f)) { applied = false; break; } fs.renameSync(f, path.join(S, e.rename)); undo.push(() => fs.renameSync(path.join(S, e.rename), f)); continue; }
    if (e.copy) { if (!fs.existsSync(f)) { applied = false; break; } fs.copyFileSync(f, path.join(S, e.copy)); undo.push(() => fs.rmSync(path.join(S, e.copy))); continue; }
    if (e.content !== undefined) { const ex = fs.existsSync(f); const o = ex ? fs.readFileSync(f, "utf8") : null; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, e.content); undo.push(() => (ex ? fs.writeFileSync(f, o) : fs.rmSync(f))); continue; }
    if (!fs.existsSync(f)) { applied = false; break; } const o = fs.readFileSync(f, "utf8"); if (!o.includes(e.from)) { applied = false; break; }
    if (e.noop) continue; fs.writeFileSync(f, o.replace(e.from, e.to)); undo.push(() => fs.writeFileSync(f, o));
  }
  if (!applied) { undo.reverse().forEach((u) => u()); console.log(`SKIP    ${x.id} ${x.label} (anchor missing)`); skipped++; continue; }
  const r = run(); undo.reverse().forEach((u) => u());
  const msg = (r.out.match(/(?:Forbidden promise wording|NEW forbidden string in backend|stale allowlist|VIDEO_UPLOAD=true requires|AssertionError)[^\n]*/) ?? [""])[0].slice(0, 90);
  let verdict, note = "";
  if (x.kind === "promise") { if (!r.ok) { verdict = "CAUGHT"; caught++; } else { verdict = "BYPASS"; byp++; note = "<-- gets through"; } }
  else if (x.kind === "fp") { if (r.ok) { verdict = "PASS"; fpOk++; note = "(legit copy allowed)"; } else { verdict = "FALSEPOS"; fpFail++; note = "<-- honest copy blocked"; } }
  else if (x.kind === "process") { verdict = r.ok ? "PASS" : "FAIL"; note = r.ok ? "(guard cannot stop an allowlist edit; needs review)" : "(caught)"; }
  else { verdict = r.ok ? "PASS" : "FALSEPOS"; note = r.ok ? "(correct: not user-facing)" : "<-- false alarm"; }
  console.log(`${verdict.padEnd(8)} ${x.id.padEnd(4)} ${x.label} ${note}${!r.ok && msg ? "  [" + msg + "]" : ""}`); rows.push({ id: x.id, kind: x.kind, verdict });
}
console.log(`SUMMARY promises: ${caught} caught, ${byp} bypass | false-positive probes: ${fpOk} allowed, ${fpFail} blocked | ${skipped} skipped, of ${M.length}`);
fs.rmSync(S, { recursive: true, force: true });
