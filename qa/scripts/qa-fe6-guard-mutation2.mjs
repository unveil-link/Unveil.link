// FE-18 round 6: 40+ NEW mutations of tests/copy-guard.test.ts (the real test run on a scratch copy; app code in the worktree is never touched).
// usage: WT=/workspace/qa-fe6 node qa-fe6-guard-mutation2.mjs   -> per mutation CAUGHT / BYPASS plus an expectation column
// Verdict column: CAUGHT = guard fails (good). BYPASS = guard still passes. [should-pass] marks mutations that are NOT user-facing (comments), where passing is correct.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { spawnSync, execSync } from "node:child_process";
const WT = process.env.WT; const S = fs.mkdtempSync("/tmp/mut.fe6."); 
execSync(`cd ${WT} && cp -r tests components lib src public vitest.config.mts tsconfig.json package.json next.config.ts ${S}/ && ln -s ${WT}/node_modules ${S}/node_modules`);
const run = () => spawnSync("npx", ["vitest", "run", "tests/copy-guard.test.ts"], { cwd: S, encoding: "utf8" }).status === 0 ? "PASS" : "FAIL";
const HERO = "access to the files is shared once payment is confirmed.";
const M = [];
const m = (id, label, file, from, to, kind = "must-catch") => M.push({ id, label, file, from, to, kind });
const mf = (id, label, file, content, kind = "must-catch") => M.push({ id, label, file, content, kind });
// --- evasion of the extractor
m("N1", "JSX text split mid-word across elements: In<b>stant</b>ly", "components/landing/Hero.tsx", HERO, "and In<b>stant</b>ly.");
m("N2", "two sibling spans: <span>Insta</span><span>ntly</span>", "components/landing/Hero.tsx", HERO, "<span>Insta</span><span>ntly</span>.");
m("N3", "phrase split across nodes: straight <b>away</b>", "components/landing/Hero.tsx", HERO, "straight <b>away</b>.");
m("N4", "phrase split across nodes: the <i>moment</i> you pay", "components/landing/Hero.tsx", HERO, "your files open the <i>moment</i> you pay.");
m("N5", "variable + literal: {(() => { const a = \"In\"; return a + \"stantly\"; })()}", "components/landing/Hero.tsx", HERO, '{(() => { const a = "In"; return a + "stantly"; })()}.');
m("N6", "template with literal holes {`${\"In\"}${\"stantly\"}`}", "components/landing/Hero.tsx", HERO, '{`${"In"}${"stantly"}`}.');
m("N7", '"In".concat("stantly")', "components/landing/Hero.tsx", HERO, '{"In".concat("stantly")}.');
m("N8", "String.fromCharCode(...) spelling 'instantly'", "components/landing/Hero.tsx", HERO, "{String.fromCharCode(105,110,115,116,97,110,116,108,121)}.");
m("N9", "atob(base64) spelling 'instantly'", "components/landing/Hero.tsx", HERO, '{atob("aW5zdGFudGx5")}.');
m("N10", "reversed string split/reverse/join", "components/landing/Hero.tsx", HERO, '{"yltnatsni".split("").reverse().join("")}.');
m("N11", "Cyrillic homoglyphs: 'Іnstantly', 'dоwnload' (U+0406, U+043E)", "components/landing/Hero.tsx", HERO, "\u0406nstantly, no d\u043Ewnl\u043Ead needed.");
m("N12", "accented letters: 'instánt dównload'", "components/landing/Hero.tsx", HERO, "instánt dównload.");
m("N13", "leet speak '1nstant d0wnload'", "components/landing/Hero.tsx", HERO, "1nstant d0wnload.");
m("N14", "[array].map(...).join('') (not a literal-array join)", "components/landing/Hero.tsx", HERO, '{["In","stantly"].map((x) => x).join("")}.');
// --- synonyms / paraphrases the rule groups might miss
m("N15", "'straightaway' (one word)", "components/landing/Hero.tsx", HERO, "you get the files straightaway.");
m("N16", "'Your files land in seconds'", "components/landing/Hero.tsx", HERO, "your files land in seconds.");
m("N17", "'We’ll send you the link'", "components/landing/Hero.tsx", HERO, "we’ll send you the link.");
m("N18", "'Check your email for access'", "components/landing/Hero.tsx", HERO, "check your email for access.");
m("N19", "'You’ll receive your files'", "components/landing/Hero.tsx", HERO, "you’ll receive your files.");
m("N20", "'confirmation email'", "components/landing/Hero.tsx", HERO, "a confirmation email follows.");
m("N21", "'Your files are ready' (the phrase DownloadPanel itself uses)", "components/landing/Hero.tsx", HERO, "your files are ready.");
m("N22", "'no waiting' / 'at once' / 'on the spot'", "components/landing/Hero.tsx", HERO, "no waiting, access at once, on the spot.");
m("N23", "Spanish: 'descarga inmediata'", "components/landing/Hero.tsx", HERO, "descarga inmediata.");
m("N24", "French: 'téléchargement instantané'", "components/landing/Hero.tsx", HERO, "téléchargement instantané.");
m("N25", "'Upload MP4 clips' (video claim without the word video)", "components/landing/Hero.tsx", "Upload your {SELLABLE}", "Upload your MP4 clips");
m("N26", "'Payouts every Friday' (schedule claim)", "components/landing/Faq.tsx", "Payout requests and processing are coming soon.", "Payouts every Friday.");
m("N27", "'All creators are fully verified'", "components/landing/BuyerTrust.tsx", "A seller must have a verified status", "All creators are fully verified");
m("N28", "'Your card details are encrypted end to end' (unverifiable security claim)", "components/landing/BuyerTrust.tsx", "and Unveil does not store card numbers.", "and your card details are encrypted end to end.");
m("N29", "'Payouts are sent automatically every week' (should be caught by bank-promise rule)", "components/landing/Faq.tsx", "Payout requests and processing are coming soon.", "Payouts are sent automatically every week.");
// --- places / file types
m("N30", "CSS pseudo-element content: \"Instant download\" in globals.css", "src/app/globals.css", "@import \"tailwindcss\";", '@import "tailwindcss";\n.hero-title::after { content: "Instant download"; }');
mf("N31", "new public/promo.svg with <text>Instant download</text>", "public/promo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><text>Instant download</text></svg>');
mf("N32", "new public/promo.json", "public/promo.json", '{"banner":"Instant download, receipt by email"}');
mf("N33", "new .mjs under src/app (not .ts/.tsx)", "src/app/promo.mjs", 'export const banner = "Instant download";');
m("N34", "SKIP_FILES entry: promise inside src/server/auth/common-passwords-data.ts (file-level skip)", "src/server/auth/common-passwords-data.ts", "export", 'export const PROMO = "Instant download, receipt by email";\nexport');
mf("N35", "new backend file src/server/mail/promo.ts with a promise (ratchet should fail)", "src/server/mail/promo.ts", 'export const SUBJECT = "Your receipt and download link";');
m("N36", "new backend string split by concat in src/app/api (same extractor)", "src/app/api/checkout/route.ts", "Provide exactly one of dropId or linkId", "Your rece\" + \"ipt will be emailed");
// --- allowlist / ratchet loopholes
m("N37", "allowlist reuse: second exact 'Download' button in DownloadPanel.tsx", "components/buyer/DownloadPanel.tsx", "<h2 className=\"text-xl font-bold tracking-tight\">", "<h2 className=\"text-xl font-bold tracking-tight\"><button>Download</button> ", "loophole");
m("N38", "flag flip: VIDEO_UPLOAD = true while the backend still answers 415", "lib/features.ts", "export const VIDEO_UPLOAD = false;", "export const VIDEO_UPLOAD = true;", "loophole");
m("N39", "hard-coded hold: PAYOUT_HOLD_DAYS = 30 (copy no longer matches platform_settings 7)", "lib/features.ts", "export const PAYOUT_HOLD_DAYS = 7;", "export const PAYOUT_HOLD_DAYS = 30;", "loophole");
m("N40", "FileDropzone hint keeps advertising MP4 (the real FE-20 string, re-added to Hero)", "components/landing/Hero.tsx", HERO, "JPG, PNG, WebP or MP4 accepted.");
// --- non-user-facing (should pass) and conservative cases
m("N41", "// line comment 'Instant download' [should-pass]", "components/landing/Hero.tsx", "export function Hero", "// Instant download receipt\nexport function Hero", "should-pass");
m("N42", "JSX comment {/* Instant download */} [should-pass]", "components/landing/Hero.tsx", HERO, HERO + " {/* Instant download */}", "should-pass");
m("N43", "unused const with the promise (conservative: should be caught)", "components/landing/Hero.tsx", "export function Hero", 'const _unused = "Instant download";\nexport function Hero');
m("N44", "type-level literal only: type Copy = \"Instant download\" [should-pass]", "components/landing/Hero.tsx", "export function Hero", 'type Copy = "Instant download";\nexport function Hero', "should-pass");
m("N45", "dangerouslySetInnerHTML with numeric entity 'Downl&#x6f;ad'", "components/landing/Hero.tsx", HERO, '<span dangerouslySetInnerHTML={{ __html: "Downl&#x6f;ad" }} />.');
m("N46", "JSON-LD in layout via JSON.stringify({description: ...})", "src/app/layout.tsx", "export const metadata", 'const ld = JSON.stringify({ description: "Instant download" });\nexport const metadata');
m("N47", "metadata.openGraph.description promise", "src/app/layout.tsx", "export const metadata", 'export const og = { openGraph: { description: "Download instantly" } };\nexport const metadata');
m("N48", "unrouted-component copy 'Thanks — your files are ready' in a NEW landing section", "components/landing/Faq.tsx", "Your dashboard shows the exact breakdown.", "Your dashboard shows the exact breakdown. Thanks — your files are ready.");
const base = run(); console.log(`baseline (unmodified copy): guard ${base}`);
let caught = 0, byp = 0, noop = 0; const rows = [];
for (const x of M) {
  const f = path.join(S, x.file); const existed = fs.existsSync(f); const orig = existed ? fs.readFileSync(f, "utf8") : null; let applied = true;
  if (x.content !== undefined) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, x.content); }
  else { if (!existed || !orig.includes(x.from)) { console.log(`SKIP    ${x.id} ${x.label} (anchor not found in ${x.file})`); noop++; continue; } fs.writeFileSync(f, orig.replace(x.from, x.to)); }
  const r = run(); if (existed) fs.writeFileSync(f, orig); else fs.rmSync(f);
  const verdict = r === "FAIL" ? "CAUGHT" : "BYPASS"; const note = x.kind === "should-pass" ? (verdict === "BYPASS" ? "(correct: not user-facing)" : "(FALSE ALARM)") : x.kind === "loophole" ? "(loophole probe)" : verdict === "BYPASS" ? "<-- promise gets through" : "";
  if (x.kind === "should-pass") { /* not counted */ } else if (verdict === "CAUGHT") caught++; else byp++;
  console.log(`${verdict.padEnd(7)} ${x.id} ${x.label} ${note}`); rows.push({ ...x, verdict });
}
console.log(`SUMMARY (excluding should-pass): ${caught} caught, ${byp} bypass, ${noop} skipped (anchor missing), of ${M.length} mutations`);
fs.rmSync(S, { recursive: true, force: true });
