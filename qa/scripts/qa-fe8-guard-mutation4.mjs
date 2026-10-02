// FE-18 round 8 (30d6a48): 60+ NEW mutations (beyond N1-N48, P/L/S/F/A/FP/C of rounds 6-7) of tests/copy-guard.test.ts (the real test, run on a scratch copy; the worktree is never touched).
// usage: WT=/workspace/qa-fe8 node qa-fe8-guard-mutation4.mjs [idFilterRegex]
// Each mutation: edits = list of {file, from, to} (replace) | {file, content} (create/overwrite) | {file, rename} | {file, remove}. kind: promise (a real false/unverifiable claim: CAUGHT is good, BYPASS is a gap),
// fp (legit copy: PASS is good, FAIL = false positive), should-pass (not user-facing), process (needs a human decision; informational).
import fs from "node:fs"; import path from "node:path"; import { spawnSync, execSync } from "node:child_process";
const WT = process.env.WT; const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; const S = fs.mkdtempSync("/tmp/mut.fe8d.");
execSync(`cd ${WT} && cp -r tests components lib src public vitest.config.mts tsconfig.json package.json next.config.ts docs ${S}/ 2>/dev/null; ln -s ${WT}/node_modules ${S}/node_modules`);
const run = () => { const r = spawnSync("npx", ["vitest", "run", "tests/copy-guard.test.ts"], { cwd: S, encoding: "utf8" }); return { ok: r.status === 0, out: (r.stdout + r.stderr) }; };
const HERO = "access to the files is shared once payment is confirmed.", HF = "components/landing/Hero.tsx", FAQ = "components/landing/Faq.tsx";
const M = []; const m = (id, kind, label, edits) => M.push({ id, kind, label, edits });
const hero = (id, kind, label, to) => m(id, kind, label, [{ file: HF, from: HERO, to }]);
const jsx = (id, kind, label, to) => m(id, kind, label, [{ file: HF, from: HERO, to: HERO + " " + to }]);
// ---- A. paraphrased delivery / speed / receipt promises (rule-group gaps)

const dummy = (extra, expr) => [{ file: HF, from: "export function Hero", to: extra + "\nexport function Hero" }, { file: HF, from: HERO, to: expr }];
const imp = (file, content, expr, kind = "promise") => [{ file, content }, { file: HF, from: "export function Hero", to: expr.imp + "\nexport function Hero" }, { file: HF, from: HERO, to: expr.use }];
// ---- A. new money / payout-timing / hold / minimum rules: paraphrases around the regexes
jsx("Q1", "promise", "'Keep ninety percent of each sale' (number spelled out)", "Keep ninety percent of each sale.");
jsx("Q2", "promise", "'Our cut is just five percent.'", "Our cut is just five percent.");
jsx("Q3", "promise", "'Zero commission on your first year.'", "Zero commission on your first year.");
jsx("Q4", "promise", "'Paid weekly.' (payout cadence, no 'payout' noun)", "Paid weekly.");
jsx("Q5", "promise", "'Get paid within 48 hours.'", "Get paid within 48 hours.");
jsx("Q6", "promise", "'Your money shows up in your account within 2 days.'", "Your money shows up in your account within 2 days.");
jsx("Q7", "promise", "'Payouts land in two working days.' (control: should be caught)", "Payouts land in two working days.");
jsx("Q8", "promise", "'A 7 day hold applies to new sales.' (literal hold days, no hyphen)", "A 7 day hold applies to new sales.");
jsx("Q9", "promise", "'Funds are held for a week.' (hold length without a digit)", "Funds are held for a week.");
jsx("Q10", "promise", "'The minimum payout is twenty-five dollars.'", "The minimum payout is twenty-five dollars.");
jsx("Q11", "promise", "'Minimum is $25.' (literal minimum, word order)", "Minimum is $25.");
jsx("Q12", "promise", "'Browsing is protected by HTTPS.'", "Browsing is protected by HTTPS.");
jsx("Q13", "promise", "'Your data is safe with us.'", "Your data is safe with us.");
jsx("Q14", "promise", "'We’re always here to help.' (support availability, no 24/7)", "We’re always here to help.");
jsx("Q15", "promise", "'Our team will reply to every message.' (support promise; /contact is a placeholder)", "Our team will reply to every message.");
jsx("Q16", "promise", "'Your files never expire.' (access duration, not 'lifetime')", "Your files never expire.");
jsx("Q17", "promise", "'Permanent access to every purchase.'", "Permanent access to every purchase.");
jsx("Q18", "promise", "'Buyer protection on every order.'", "Buyer protection on every order.");
// ---- B. more languages for 'instant'
hero("L5", "promise", "Russian: 'Мгновенная загрузка файлов' (instant download)", "Мгновенная загрузка файлов.");
hero("L6", "promise", "Korean: '결제 즉시 다운로드' (instant download)", "결제 즉시 다운로드.");
hero("L7", "promise", "Dutch: 'Direct toegang tot je bestanden' (immediate access)", "Direct toegang tot je bestanden.");
hero("L8", "promise", "Turkish: 'Ödemeden hemen sonra indirin' (right after payment)", "Ödemeden hemen sonra indirin.");
hero("L9", "promise", "Italian: 'Accesso subito dopo il pagamento'", "Accesso subito dopo il pagamento.");
hero("L10", "promise", "Arabic: 'تحميل فوري' (instant download)", "تحميل فوري.");
hero("L11", "promise", "Polish: 'Natychmiastowy dostęp do plików'", "Natychmiastowy dostęp do plików.");
hero("L12", "promise", "German: 'Dateien erhältst du in Sekunden' (in seconds)", "Dateien erhältst du in Sekunden.");
// ---- C. new folding (object props, destructuring, +=, .replace, spread, ternary): what it still cannot fold
m("Q19", "promise", "name poisoning: same identifier declared twice in the file (dup => folding disabled), e.g. w1/w2", dummy('const w1 = "In"; const w2 = "stantly"; function _u() { const w1 = 1; return w1; }', "{w1 + w2}."));
m("Q20", "promise", "Object.values({a:'In',b:'stantly'}).join('')", [{ file: HF, from: HERO, to: '{Object.values({ a: "In", b: "stantly" }).join("")}.' }]);
m("Q21", "promise", "reduce: ['In','stantly'].reduce((a, b) => a + b)", [{ file: HF, from: HERO, to: '{["In", "stantly"].reduce((a, b) => a + b)}.' }]);
m("Q22", "promise", "JSON.parse('[\"In\",\"stantly\"]').join('')", [{ file: HF, from: HERO, to: "{JSON.parse('[\"In\",\"stantly\"]').join(\"\")}." }]);
m("Q23", "promise", "non-identity map: ['IN','STANTLY'].map((s) => s.toLowerCase()).join('')", [{ file: HF, from: HERO, to: '{["IN", "STANTLY"].map((s) => s.toLowerCase()).join("")}.' }]);
m("Q24", "promise", "ternary with different branches: {big ? 'In' : 'Con'}stantly", dummy("const big = SELLABLE.length > 0;", '{big ? "In" : "Con"}stantly.'));
m("Q25", "promise", "helper with parameters: const j = (a, b) => a + b; j('In','stantly')", dummy("const j = (a: string, b: string) => a + b;", '{j("In", "stantly")}.'));
m("Q26", "promise", "spread into fromCharCode: String.fromCharCode(...[105,110,115,116,97,110,116,108,121])", [{ file: HF, from: HERO, to: "{String.fromCharCode(...[105, 110, 115, 116, 97, 110, 116, 108, 121])}." }]);
m("Q27", "promise", "Buffer base64 (server component): Buffer.from('aW5zdGFudGx5','base64').toString()", [{ file: HF, from: HERO, to: "{Buffer.from(\"aW5zdGFudGx5\", \"base64\").toString()}." }]);
m("Q28", "promise", "enum members: enum E { A = 'In', B = 'stantly' }; E.A + E.B", dummy('enum E { A = "In", B = "stantly" }', "{E.A + E.B}."));
m("Q29", "promise", "object method: const o = { p() { return 'In'; } }; o.p() + 'stantly'", dummy('const o = { p() { return "In"; } };', '{o.p() + "stantly"}.'));
m("Q30", "promise", "filter(Boolean) after reverse: Array.from('yltnatsni').reverse().filter(Boolean).join('')", [{ file: HF, from: HERO, to: '{Array.from("yltnatsni").reverse().filter(Boolean).join("")}.' }]);
m("Q31", "promise", "class static: class C { static a = 'In' }; C.a + 'stantly'", dummy('class C { static a = "In"; }', '{C.a + "stantly"}.'));
m("Q32", "promise", "padEnd / at: 'Instantx'.slice(0, -1) via negative slice", [{ file: HF, from: HERO, to: '{"Instantlyx".slice(0, -1)}.' }]);
m("Q33", "promise", "reassigned let (not statement-level +=): let s = 'In'; if (c) { s = s + 'stantly'; } (dup => opaque)", dummy('let s2 = "In"; s2 = s2 + "stantly";', "{s2}."));
m("Q34", "promise", "name poisoning for a destructured pair", dummy('const { p1, p2 } = { p1: "In", p2: "stantly" }; function _v() { const p1 = 0; return p1; }', "{p1 + p2}."));
m("Q35", "promise", "template literal in a computed property used as text: `${'In'}${'stantly'}` via array join of template parts", [{ file: HF, from: HERO, to: '{[`In`, `stantly`].join(``)}.' }]);
m("Q36", "promise", "S6 variant: children composition <Wrap>In</Wrap>stantly (custom component = word break?)", [{ file: HF, from: "export function Hero", to: 'const Wrap = ({ children }: { children: React.ReactNode }) => <>{children}</>;\nexport function Hero' }, { file: HF, from: HERO, to: "<Wrap>In</Wrap>stantly." }]);
m("Q37", "promise", "S10 variant: bidi reversal through Tailwind arbitrary classes, text reversed in an attribute-free span: <span className=\"[direction:rtl] [unicode-bidi:bidi-override]\">yltnatsni</span>", [{ file: HF, from: HERO, to: '<span className="[direction:rtl] [unicode-bidi:bidi-override]">yltnatsni</span>.' }]);
m("Q38", "promise", "S13 variant: JSON module with a nested object joined: copy.a + copy.b", [{ file: "public/promo-parts2.json", content: '{"a":"In","b":"stantly"}' }, { file: HF, from: "export function Hero", to: 'import promo2 from "../../public/promo-parts2.json";\nexport function Hero' }, { file: HF, from: HERO, to: "{promo2.a + promo2.b}." }]);
m("Q39", "promise", "i18n-style: keys built at run time from a dictionary of fragments: D['x'+n]", dummy('const D: Record<string, string> = { x1: "In", x2: "stantly" }; const n = SELLABLE.length;', "{D[`x${n % 2 + 1}`]}{D.x2}."));
// ---- D. new scan scope (exclude-list) edges
const exportImp = (file, content, spec) => [{ file, content }, { file: HF, from: "export function Hero", to: `import { PROMO } from "${spec}";\nexport function Hero` }, { file: HF, from: HERO, to: "{PROMO}." }];
m("Q40", "promise", "tmp/promo.ts imported by Hero (tmp/ is in EXCLUDED_TOP)", exportImp("tmp/promo.ts", 'export const PROMO = "Instant download";', "../../tmp/promo"));
m("Q41", "promise", "build/promo.ts imported by Hero (build/ excluded)", exportImp("build/promo.ts", 'export const PROMO = "Instant download";', "../../build/promo"));
m("Q42", "promise", "out/promo.ts imported by Hero (out/ excluded)", exportImp("out/promo.ts", 'export const PROMO = "Instant download";', "../../out/promo"));
m("Q43", "promise", "docs/promo.ts imported by Hero (docs/ excluded)", exportImp("docs/promo.ts", 'export const PROMO = "Instant download";', "../../docs/promo"));
m("Q44", "promise", "scripts/promo.ts imported by Hero (scripts/ excluded)", exportImp("scripts/promo.ts", 'export const PROMO = "Instant download";', "../../scripts/promo"));
m("Q45", "promise", "tests/helpers/promo.ts imported by Hero (tests/ excluded)", exportImp("tests/helpers/promo.ts", 'export const PROMO = "Instant download";', "../../tests/helpers/promo"));
m("Q46", "promise", ".content/promo.ts (dot-folder at top level is skipped)", exportImp(".content/promo.ts", 'export const PROMO = "Instant download";', "../../.content/promo"));
m("Q47", "promise", "db/promo.ts imported by Hero (db/ excluded)", exportImp("db/promo.ts", 'export const PROMO = "Instant download";', "../../db/promo"));
m("Q48", "promise", "root-level promo.json imported (root files: code only)", [{ file: "promo.json", content: '{"t":"Instant download"}' }, { file: HF, from: "export function Hero", to: 'import rootPromo from "../../promo.json";\nexport function Hero' }, { file: HF, from: HERO, to: "{rootPromo.t}." }]);
m("Q49", "promise", "messages/en.yaml read at request time (yaml not a scanned extension)", [{ file: "messages/en.yaml", content: "hero: Instant download\n" }]);
m("Q50", "promise", "public/promo.jsonc (jsonc not scanned)", [{ file: "public/promo.jsonc", content: '{ "t": "Instant download" }' }]);
m("Q51", "promise", "copy in .po / .csv / .toml (messages/en.po)", [{ file: "messages/en.po", content: 'msgid "hero"\nmsgstr "Instant download"\n' }]);
m("Q52", "promise", ".env.production NEXT_PUBLIC_TAGLINE read via process.env in Hero", [{ file: ".env.production", content: "NEXT_PUBLIC_TAGLINE=Instant download\n" }, { file: HF, from: HERO, to: "{process.env.NEXT_PUBLIC_TAGLINE}." }]);
m("Q53", "promise", "src/app/promo.vue-style .astro/.svelte file (extension not scanned)", [{ file: "src/app/promo.svelte", content: "<p>Instant download</p>" }]);
m("Q54", "promise", "components/promo.json5 / .yml next to components (not scanned)", [{ file: "components/promo.yml", content: "t: Instant download\n" }]);
m("Q55", "promise", "email template emails/receipt.mjml (newly scanned ext, new top-level folder) — control: should be caught", [{ file: "emails/receipt.mjml", content: "<mjml><mj-text>Your receipt is attached</mj-text></mjml>" }]);
m("Q56", "promise", "src/server/mail/receipt.ejs (newly scanned ext, backend ratchet) — control: should be caught", [{ file: "src/server/mail/receipt.ejs", content: "<p>Your download link is below</p>" }]);
// ---- E. honest-copy carve-outs used to smuggle a promise
jsx("Q57", "promise", "carve-out smuggling: 'Receipts are not available yet (we email you one).'", "Receipts are not available yet (we email you one).");
jsx("Q58", "promise", "carve-out smuggling: 'Files land in seconds (link valid for 1 hour).'", "Files land in seconds (link valid for 1 hour).");
jsx("Q59", "promise", "carve-out smuggling: 'Buyers can download the files as a CSV.'", "Buyers can download the files as a CSV.");
jsx("Q60", "promise", "carve-out smuggling: 'Files arrive in seconds - retry if not.'", "Files arrive in seconds - retry if not.");
jsx("Q61", "promise", "carve-out smuggling: 'Downloads are not available yet - they unlock instantly later.' (instant stays caught?)", "Downloads are not available yet (they unlock instantly later).");
// ---- F. flag / allowlist / ratchet
m("A11", "promise", "A8+: flag made 'possibly true' (`= false as boolean`, still false in the app) + video copy + any backend 'video/mp4' string => guard accepts 'Upload your MP4 videos'", [{ file: "lib/features.ts", from: "export const VIDEO_UPLOAD = false;", to: "export const VIDEO_UPLOAD = false as boolean;" }, { file: "src/server/services/dummy.ts", content: 'export const X = "video/mp4";' }, { file: HF, from: HERO, to: HERO + " Upload your MP4 videos." }]);
m("A12", "promise", "contact flag: /contact is still the placeholder but its page no longer contains the text 'ComingSoon' (re-export alias Pending) + 'Contact support if anything goes wrong'", [{ file: "components/landing/Pending.tsx", content: 'export { ComingSoon as Pending, comingSoonRobots as pendingRobots } from "./ComingSoon";' }, { file: "src/app/contact/page.tsx", from: 'import { ComingSoon, comingSoonRobots } from "@/components/landing/ComingSoon";', to: 'import { Pending, pendingRobots } from "@/components/landing/Pending";' }, { file: "src/app/contact/page.tsx", from: "robots: comingSoonRobots", to: "robots: pendingRobots" }, { file: "src/app/contact/page.tsx", from: '<ComingSoon title="Contact" />', to: '<Pending title="Contact" />' }, { file: HF, from: HERO, to: HERO + " Contact support if anything goes wrong." }]);
m("A13", "promise", "backend ratchet: add a promise string to a NEW file under src/app/api (baseline is per-file/count?)", [{ file: "src/app/api/ping2/route.ts", content: 'export const GET = () => Response.json({ message: "Your files will arrive instantly" });' }]);
m("A14", "promise", "backend ratchet: promise appended to an already-baselined backend string (same file, same count)", [{ file: "src/server/mail/index.ts", from: "export interface MailMessage", to: 'export const _extra = "Receipt emailed instantly";\nexport interface MailMessage' }]);
m("A16", "promise", "A8 in full: flag `= false as boolean` (app still false) + dummy backend 'video/mp4' string + the 21 now-stale video allowlist entries removed (an allowlist edit, A6 class) + 'Upload your MP4 videos.' copy => guard accepts a video claim while the real flag is false", [{ file: "lib/features.ts", from: "export const VIDEO_UPLOAD = false;", to: "export const VIDEO_UPLOAD = false as boolean;" }, { file: "src/server/services/dummy.ts", content: 'export const X = "video/mp4";' }, { file: "tests/copy-guard.allowlist.ts", from: ' { file: "src/server/auth/common-passwords-data.ts", text: "video", reason: PASSWORD_WORD },\n]', to: ' { file: "src/server/auth/common-passwords-data.ts", text: "video", reason: PASSWORD_WORD },\n]\nconst _drop = new Set(["components/landing/PaymentLinkMock.tsx|12 photos · 2 videos", "lib/features.ts|photos and videos", "lib/features.ts|(video is coming soon)", "lib/format.ts|video", "lib/upload-limits.ts|video/mp4", "lib/upload-limits.ts|.mp4", "lib/upload-limits.ts|JPG, PNG, WebP or MP4", "lib/upload-limits.ts|MP4 video up to {} each.", "lib/upload-limits.ts|Video upload is coming soon.", "lib/upload-limits.ts|Video upload is coming soon — for now, add JPG, PNG or WebP images.", "lib/upload-limits.ts|Videos can be up to {} MB.", "src/app/api/public/drops/[linkId]/route.ts|video", "src/server/services/drops.ts|video", "src/server/auth/common-passwords-data.ts|clips", "src/server/auth/common-passwords-data.ts|film", "src/server/auth/common-passwords-data.ts|films", "src/server/auth/common-passwords-data.ts|films+pic+galeries", "src/server/auth/common-passwords-data.ts|movie", "src/server/auth/common-passwords-data.ts|movies", "src/server/auth/common-passwords-data.ts|streaming", "src/server/auth/common-passwords-data.ts|video"]);\nfor (const arr of [ALLOW, BACKEND_BASELINE]) for (let i = arr.length - 1; i >= 0; i--) if (_drop.has(arr[i].file + "|" + arr[i].text)) arr.splice(i, 1);\n' }, { file: HF, from: HERO, to: HERO + " Upload your MP4 videos." }]);
m("A15", "process", "A6: allowlist edit that approves a new promise string (re-test: still passes, no CODEOWNERS / branch rule)", [{ file: HF, from: HERO, to: HERO + ' {"Instant download."}' }, { file: "tests/copy-guard.allowlist.ts", from: "export const ALLOW: Allow[] = [", to: 'export const ALLOW: Allow[] = [ { file: "components/landing/Hero.tsx", text: "Instant download.", reason: "reviewed and fine, honest" },' }]);


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
  console.log(`${verdict.padEnd(8)} ${x.id.padEnd(4)} ${x.label} ${note}${!r.ok && msg ? "  [" + msg + "]" : ""}`); if (process.env.VERBOSE && !r.ok) console.log(r.out.split("\n").filter((l) => /^\s+\S+:\d+ \[|dynamic-string|opaque/.test(l)).slice(0, 4).join("\n")); rows.push({ id: x.id, kind: x.kind, verdict });
}
console.log(`SUMMARY promises: ${caught} caught, ${byp} bypass | false-positive probes: ${fpOk} allowed, ${fpFail} blocked | ${skipped} skipped, of ${M.length}`);
fs.rmSync(S, { recursive: true, force: true });
