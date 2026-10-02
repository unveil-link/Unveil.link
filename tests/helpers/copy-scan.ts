import ts from "typescript";

/**
 * Copy-guard scanner (FE-18 / FE-18b).
 *
 * 1. EXTRACTION (what a user can read). TS/TSX/JS/MJS are parsed with the TypeScript compiler: JSX text, string / template literals, concatenation,
 *    and anything that constant-folds to a string (`"In".concat("stantly")`, `String.fromCharCode(..)`, `atob("..")`, `"..".split("").reverse().join("")`,
 *    `[..].map(x => x).join("")`, IIFEs, `const` strings) is turned into the string a user would see. JSX text split across inline elements
 *    (`In<b>stant</b>ly`, `straight <b>away</b>`) is re-assembled into "runs". Obfuscation helpers that cannot be folded (`fromCharCode(dynamic)`,
 *    `atob(dynamic)`, `.reverse()` on unknown values ...) are reported as `dynamic-string`. CSS (quoted strings / `content:`), SVG / HTML (text nodes and
 *    title / aria-label / alt / content attributes), JSON / webmanifest (all string values) and Markdown / text are scanned as well.
 *    Identifiers (DownloadIcon), comments, type-level literals and import / export specifiers are not copy.
 * 2. NORMALISATION. HTML entities, NFKC/NFKD (full-width, accents stripped), zero-width characters, Cyrillic / Greek look-alikes folded to ASCII, contractions
 *    expanded ("we'll" -> "we will"), case folded; a leet form ("1nstant", "d0wnload") and a letters-only form ("in stant") are checked too.
 * 3. RULES. Paraphrase-tolerant groups for delivery / receipt / e-mail promises, "instant" synonyms (EN + ES / FR / DE), money & payout promises,
 *    trust & processing claims, review / support claims, and flag-tied capability claims (video / MP4 while VIDEO_UPLOAD=false, "contact support"
 *    while /contact is a placeholder).
 *
 * KNOWN LIMITS (static analysis cannot know these): strings that arrive at run time (API responses, DB rows, i18n catalogues loaded dynamically);
 * values built from non-constant data; claims expressed in a language or phrasing we have no rule for; images; a promise made only by layout or
 * by something that is NOT text (e.g. a green "instant" icon). The runtime e2e [copy-sweep] covers rendered pages and API strings to narrow that gap.
 */
export type Unit = { file: string; text: string; line: number; parts?: string[] };
export type Hit = Unit & { rule: string; norm: string };
export type Flags = { videoUpload: boolean; contactPlaceholder: boolean };

// ------------------------------------------------------------------------------------------------------------------ normalisation
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", shy: "", zwnj: "", zwj: "", eacute: "e", egrave: "e", aacute: "a", oacute: "o", iacute: "i", uacute: "u", ntilde: "n", ccedil: "c", uuml: "u", ouml: "o", auml: "a" };
const safeChr = (n: number) => { try { return String.fromCodePoint(n); } catch { return ""; } };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}
/** Cyrillic / Greek / misc look-alikes -> ASCII skeleton (applied after lower-casing and accent stripping). */
const HOMO: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "з": "3", "и": "u", "й": "u", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "һ": "h", "ӏ": "l", "ԛ": "q", "ԝ": "w", "ь": "b", "ѵ": "v", "ү": "y", "ғ": "f",
  "α": "a", "β": "b", "γ": "y", "ε": "e", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p", "σ": "o", "τ": "t", "υ": "u", "χ": "x", "η": "n", "ω": "w", "ϲ": "c", "ϳ": "j",
  "ı": "i", "ɩ": "i", "ɡ": "g", "ɑ": "a", "ᴅ": "d", "ʟ": "l", "ꞓ": "c", "ꓲ": "l", "ǀ": "l", "∣": "l",
};
const ZERO_WIDTH = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff]/g;
export function normalize(raw: string): string {
  let s = decodeEntities(raw).normalize("NFKD").replace(/\p{M}+/gu, "").replace(ZERO_WIDTH, "").toLowerCase();
  s = s.replace(/[\u2018\u2019\u02bc`´]/g, "'").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/&/g, " and ");
  s = Array.from(s, (c) => HOMO[c] ?? c).join("");
  s = s.replace(/\bwon't\b/g, "will not").replace(/\bcan't\b/g, "can not").replace(/n't\b/g, " not").replace(/'ll\b/g, " will").replace(/'re\b/g, " are").replace(/'ve\b/g, " have").replace(/'d\b/g, " would").replace(/\blet's\b/g, "let us");
  return s.replace(/\s+/g, " ").trim();
}
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
/** Leet-speak form: only tokens that mix letters with leet digits / symbols are rewritten ("1nstant" -> "instant"; "$25" and "7-day" are left alone unless they mix). */
export function leet(norm: string): string {
  return norm.split(" ").map((t) => (/[a-z]/.test(t) && /[013457@$]/.test(t) && /[a-z][013457@$]|[013457@$][a-z]/.test(t) ? t.replace(/[013457@$]/g, (c) => LEET[c]) : t)).join(" ");
}
const squash = (norm: string) => norm.replace(/[^a-z]/g, "");

// ------------------------------------------------------------------------------------------------------------------ rules
type Rule = [name: string, re: RegExp, when?: (f: Flags) => boolean];
const NOUN = "(?:receipts?|confirmation|order|invoice|download|files?|links?|access|photos?|images?|content|purchase|videos?)";
export const RULES: Rule[] = [
  // -- speed / immediacy
  ["instant", /\binstant(?:ly|aneous(?:ly)?|ane|aneo|anea|aneamente)?\b/],
  ["immediate", /\b(?:immediate(?:ly)?|immediat\w*|inmediat\w*|unverzueglich|sofort\w*|al instante|de inmediato)\b/],
  ["right-away", /\b(?:right|straight) ?away\b|\bat once\b|\bon the spot\b|\bno waiting\b|\bwithout (?:any )?(?:waiting|delay)\b|\bin no time\b|\bin an? (?:flash|snap|jiffy|heartbeat)\b|\bwait(?:ing)? (?:for )?nothing\b/],
  ["in-seconds", new RegExp(`\\bseconds? (?:after|of) (?:you |your |the )?(?:pay|purchase|checkout|buy|order)|\\b(?:land|arrive|appear|show up|reach|open|unlock|get|receive|ready)\\w*\\b.{0,40}\\b(?:in|within) (?:a )?(?:few |couple of |\\d+ )?seconds?\\b|\\b${NOUN}\\b.{0,30}\\b(?:in|within) (?:a )?(?:few |couple of |\\d+ )?seconds?\\b`)],
  ["moment-you-pay", /\b(?:the )?(?:very )?(?:moment|second|minute|instant) (?:you|your|payment|it|they)\b|\bready the moment\b|\bas soon as (?:you|your|payment|the payment|it|they|a payment)\b|\bonce (?:you have |you've |you )?paid\b/],
  // -- receipts, e-mail & delivery promises
  ["receipt", /\b(?:receipts?|recibos?|recu|quittung\w*|invoices?|facture|rechnung)\b/],
  ["email-promise", new RegExp(`\\bemailed\\b|\\bmailed\\b|\\be-?mail(?:s|ing)? (?:you|them|buyers?)\\b|\\b(?:send|sends|sending|sent|forward|forwards|deliver|delivers)\\b (?:you |buyers? |them |it |over )?(?:to (?:you|your|them) )?(?:a |an |the |your |their |that |all )?${NOUN}\\b|\\bsent to (?:your|their|the buyer's?) (?:e-?mail|inbox|address)|\\bcheck your (?:e-?mail|inbox|spam|mail)|\\b(?:in|to|into) your (?:e-?mail|inbox|mailbox)\\b|\\bconfirmation (?:e-?mail|message)\\b|\\be-?mail confirmation\\b|\\bwe will (?:e-?mail|mail|send|forward|deliver)\\b`)],
  ["inbox", /\binbox\b|\barrive in your\b|\bmailbox\b/],
  ["receive-promise", new RegExp(`\\byou (?:will )?(?:receive|get|have|find) (?:your |the |an? |all )?${NOUN}\\b|\\breceive (?:your|the|an?) ${NOUN}\\b`)],
  ["files-ready", /\b(?:files?|photos?|downloads?|content|purchase|order|videos?|images?|access|links?)s? (?:(?:is|are|will be|be|now|already|all) )*ready\b|\bready (?:to|for) (?:download|open|view|use|access)\b/],
  ["backup-link", /\bbackup (?:download )?links?\b/],
  ["auto-deliver", /\bautomatic(?:ally)?\b.{0,40}\b(?:deliver\w*|unlock\w*|(?:send\w*|sent)|e-?mail\w*|download\w*|receiv\w*|pay\w*|access\w*)|\b(?:deliver|unlock|send|sent|email|download|receive|pay|payout)\w*\b.{0,40}\bautomatic(?:ally)?\b|\bauto[- ]?(?:deliver|download|send|unlock|pay)/],
  ["deliver", /\bdeliver(?:y|ies|ed|s|ing)?\b|\bentrega\w*|\blivraison\b|\blieferung\b|\bzustell\w*/],
  ["signed-link", /\bsigned[- ]?(?:url|link)s?\b/],
  ["pay-and-download", /\bpay (?:and|\+) (?:download|unlock|get)\b/],
  ["download", /\b(?:download(?:s|ed|ing|able)?|descarg\w*|telecharg\w*|herunterlad\w*)\b/],
  ["unlock", /\bunlock(?:s|ed|ing)?\b|\bdesbloque\w*|\bdeverrouill\w*|\bfreischalt\w*/],
  // -- money & payouts
  ["paid-out", /\bpaid out\b|\bpay ?outs? (?:are |is |will be )?(?:sent|paid|deposited|made)\b/],
  ["payout-schedule", /\bpay ?outs?\b.{0,25}\b(?:straight|direct(?:ly)?|daily|weekly|monthly|every|each|same ?day|next ?day|instant\w*|automatic\w*|within \d)|\b(?:weekly|daily|monthly|bi-?weekly|fortnightly|instant|same-day|next-day|same day|next day|automatic) (?:pay ?outs?|payments?|pay|deposits?|transfers?)\b|\bget paid (?:instantly|daily|weekly|fast|quickly|automatically|directly|today)\b|\bevery (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekday|day|month)\b|\bregular schedule\b/],
  ["bank-promise", /\bbank (?:transfers?|deposits?|accounts?)\b|\bdirect deposit\b|\bwire transfer\b|\bstraight to your\b|\b(?:to|into) your (?:bank|account|paypal|iban)\b|\bwithdraw\w*\b|\bcash ?out\b|\bsame[- ]day\b|\bnext[- ]day\b|\bguarantee\w*\b/],
  // -- trust & processing claims
  ["trusted-provider", /\btrusted (?:payment )?(?:provider|processor|partner|platform)\b|\bpayments? partner\b|\bbank[- ]?(?:level|grade|class)\b|\bmilitary[- ]grade\b|\bpci\b|\bcertified\b|\biso ?27001\b|\bsoc ?2\b|\bgdpr[- ]compliant\b|\bfully (?:secure|insured|protected)\b|\b100 ?% ?(?:secure|safe|private|anonymous)\b|\bend[- ]to[- ]end\b|\bencrypt\w*\b|\bfraud[- ]?(?:proof|free)\b|\brisk[- ]free\b|\bmoney[- ]back\b|\bsafe and secure\b|\bunhackable\b/],
  ["verified-claims", /\b(?:identity|age)[- ](?:and |& )?(?:age|identity)?[- ]?verif|\bage[- ]verified\b|\bidentity[- ]verified\b|\bid[- ]verified\b|\bkyc\b|\bbackground[- ]check\w*|\bfully verified\b|\b100 ?% ?verified\b|\b(?:all|every|each) (?:creators?|sellers?) (?:is |are )?(?:fully |100 ?% |identity |age |background )?(?:verified|vetted|screened|checked)\b/],
  ["private-to-creator", /\bprivate to (?:the )?(?:creator|seller)\b/],
  // -- review / support claims (nothing behind them today)
  ["support-claim", /\bcontact (?:our |the |customer )?(?:support|team|us|help)\b|\b(?:customer|live|our) support\b|\bsupport (?:team|center|centre|email|chat)\b|\bhelp ?desk\b|\bwrite to us\b/, (f) => f.contactPlaceholder],
  ["human-review", /\ba (?:real )?(?:person|human|team member|specialist|agent|moderator)\b.{0,25}\b(?:review\w*|check\w*|verif\w*|look\w*)|\bour (?:team|staff|moderators?|reviewers?)\b.{0,25}\b(?:review\w*|check\w*|verif\w*|look\w*)|\b(?:reviewed|checked|verified|approved) by (?:a |our |an? )?(?:person|human|team|moderator|staff|specialist)|\bhuman review\b|\bwe will (?:review|verify|check) your\b|\b(?:usually|typically) (?:takes|within)\b/],
  // -- capability claims tied to flags
  ["video-claim", /\bvideos?\b(?!\/)|\bmp4s?\b|\bclips?\b|\bmovies?\b|\bfootage\b|\bwebm\b|\bfilms?\b|\bstreaming\b/, (f) => !f.videoUpload],
];
/** Letters-only stems (spacing / punctuation tricks: "in stant", "down-load"). [rule, stem] */
const SQUASHED: Array<[string, string]> = [
  ["instant", "instant"], ["immediate", "immediate"], ["receipt", "receipt"], ["download", "download"], ["right-away", "rightaway"], ["right-away", "straightaway"],
  ["signed-link", "signedlink"], ["backup-link", "backuplink"], ["inbox", "inbox"], ["auto-deliver", "autodeliver"], ["pay-and-download", "payanddownload"],
  ["unlock", "unlock"], ["deliver", "deliver"], ["paid-out", "paidout"],
];

export function checkUnit(u: Unit, flags: Flags = { videoUpload: false, contactPlaceholder: true }): Hit[] {
  const norm = normalize(u.text);
  const forms = [norm, leet(norm)];
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const [rule, re, when] of RULES) {
    if (when && !when(flags)) continue;
    if (forms.some((f) => re.test(f))) { seen.add(rule); hits.push({ ...u, rule, norm }); }
  }
  const sq = squash(norm);
  for (const [rule, stem] of SQUASHED) if (!seen.has(rule) && sq.includes(stem) && !norm.includes(stem)) { seen.add(rule); hits.push({ ...u, rule: rule + " (spacing trick)", norm }); }
  return hits;
}

// ------------------------------------------------------------------------------------------------------------------ constant folding
type Val = string | number | string[] | number[] | undefined;
type Env = Map<string, Val>;
const strOf = (v: Val): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

function buildEnv(sf: ts.SourceFile): Env {
  const env: Env = new Map(); const dup = new Set<string>();
  const decls: ts.VariableDeclaration[] = [];
  const collect = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.push(n); ts.forEachChild(n, collect); };
  collect(sf);
  for (const d of decls) { const name = (d.name as ts.Identifier).text; if (env.has(name) || dup.has(name)) { dup.add(name); env.delete(name); } else env.set(name, undefined); }
  // fold in source order, a few passes so `const b = a + "x"` resolves
  for (let pass = 0; pass < 3; pass++) for (const d of decls) { const name = (d.name as ts.Identifier).text; if (dup.has(name) || env.get(name) !== undefined) continue; const v = evalValue(d.initializer!, env); if (typeof v === "string" || Array.isArray(v) || typeof v === "number") env.set(name, v); }
  return env;
}
const unwrap = (n: ts.Node): ts.Node => (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n) ? unwrap(n.expression) : n);
const isIdentityFn = (f: ts.Node) => (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && f.parameters.length >= 1 && ts.isIdentifier(f.parameters[0].name) &&
  (() => { const b = f.body; const p = (f.parameters[0].name as ts.Identifier).text; if (ts.isIdentifier(b)) return b.text === p; if (ts.isBlock(b) && b.statements.length === 1 && ts.isReturnStatement(b.statements[0]) && b.statements[0].expression) { const e = unwrap(b.statements[0].expression); return ts.isIdentifier(e) && e.text === p; } return false; })();

export function evalValue(node: ts.Node, env: Env, depth = 0): Val {
  if (depth > 30) return undefined;
  const n = unwrap(node);
  const ev = (x: ts.Node) => evalValue(x, env, depth + 1);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isIdentifier(n)) return env.get(n.text);
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((sp) => (strOf(ev(sp.expression)) ?? "{}") + sp.literal.text).join("");
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = ev(n.left), r = ev(n.right);
    if (typeof l === "number" && typeof r === "number") return l + r;
    const ls = strOf(l), rs = strOf(r);
    if (ls === undefined && rs === undefined) return undefined;
    if (typeof l === "string" || typeof r === "string" || ts.isStringLiteral(unwrap(n.left)) || ts.isStringLiteral(unwrap(n.right))) return (ls ?? "{}") + (rs ?? "{}");
    return undefined;
  }
  if (ts.isArrayLiteralExpression(n)) {
    const els = n.elements.map(ev);
    if (els.every((x) => typeof x === "string")) return els as string[];
    if (els.every((x) => typeof x === "number")) return els as number[];
    if (els.some((x) => typeof x === "string")) return els.map((x) => strOf(x) ?? "{}");
    return undefined;
  }
  if (ts.isCallExpression(n)) {
    const callee = unwrap(n.expression);
    // IIFE
    if ((ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) && n.arguments.length === 0 && callee.parameters.length === 0) {
      if (!ts.isBlock(callee.body)) return ev(callee.body);
      const local: Env = new Map(env);
      for (const st of callee.body.statements) {
        if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) local.set(d.name.text, evalValue(d.initializer, local, depth + 1)); continue; }
        if (ts.isReturnStatement(st) && st.expression) return evalValue(st.expression, local, depth + 1);
      }
      return undefined;
    }
    const args = n.arguments.map(ev);
    if (ts.isIdentifier(callee)) {
      const a0 = strOf(args[0]);
      if (callee.text === "atob" && a0 !== undefined) { try { return Buffer.from(a0, "base64").toString("binary"); } catch { return undefined; } }
      if (callee.text === "decodeURIComponent" && a0 !== undefined) { try { return decodeURIComponent(a0); } catch { return undefined; } }
      if (callee.text === "unescape" && a0 !== undefined) { try { return decodeURIComponent(escape(a0)); } catch { return a0; } }
      if (callee.text === "String" && args.length === 1) return strOf(args[0]);
      return undefined;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const name = callee.name.text;
      if (ts.isIdentifier(callee.expression) && callee.expression.text === "String" && (name === "fromCharCode" || name === "fromCodePoint")) {
        const nums = args.flatMap((a) => (Array.isArray(a) ? (a as unknown[]) : [a]));
        return nums.every((x) => typeof x === "number") ? String.fromCodePoint(...(nums as number[])) : undefined;
      }
      const obj = ev(callee.expression);
      if (typeof obj === "string") {
        const a0 = strOf(args[0]), a1 = strOf(args[1]);
        switch (name) {
          case "concat": return obj + args.map((a) => strOf(a) ?? "{}").join("");
          case "split": return a0 !== undefined ? obj.split(a0) : undefined;
          case "toLowerCase": case "toLocaleLowerCase": return obj.toLowerCase();
          case "toUpperCase": case "toLocaleUpperCase": return obj.toUpperCase();
          case "trim": return obj.trim();
          case "repeat": return typeof args[0] === "number" ? obj.repeat(args[0]) : undefined;
          case "slice": case "substring": return obj.slice(typeof args[0] === "number" ? args[0] : 0, typeof args[1] === "number" ? args[1] : undefined);
          case "replace": case "replaceAll": return a0 !== undefined && a1 !== undefined ? obj.split(a0).join(a1) : undefined;
          case "normalize": return obj.normalize();
          default: return undefined;
        }
      }
      if (Array.isArray(obj)) {
        switch (name) {
          case "reverse": return [...obj].reverse() as string[];
          case "join": { const sep = n.arguments.length ? strOf(args[0]) : ","; return sep === undefined ? undefined : (obj as Array<string | number>).join(sep); }
          case "map": return n.arguments[0] && isIdentityFn(unwrap(n.arguments[0])) ? obj : undefined;
          case "concat": return (obj as string[]).concat(...(args.filter(Array.isArray) as string[][]));
          case "slice": return obj.slice(typeof args[0] === "number" ? args[0] : 0, typeof args[1] === "number" ? args[1] : undefined) as string[];
          default: return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Calls that build strings in a way a reader of the source cannot see; when they do NOT fold to a constant they are reported as `dynamic-string`. */
const OBFUSCATORS = new Set(["fromCharCode", "fromCodePoint", "atob", "decodeURIComponent", "unescape", "charCodeAt", "codePointAt", "reverse"]);

// ------------------------------------------------------------------------------------------------------------------ extraction
const INLINE_TAGS = new Set(["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "del", "ins", "font", "big", "tt", "label"]);
const isStringy = (n: ts.Node) =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) ||
  (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) || ts.isCallExpression(n);

const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

export type FoldIssue = { file: string; line: number; text: string };

export function extractUnits(file: string, source: string, issues: FoldIssue[] = []): Unit[] {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.(m|c)?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const env = buildEnv(sf);
  const out: Unit[] = [];
  const push = (n: ts.Node, text: string, parts?: string[]) => {
    const lines = text.split("\n");
    if (lines.length >= 20) { for (const l of lines) { const t = clean(l); if (t) out.push({ file, text: t, line: lineOf(sf, n) }); } return; } // word lists: one unit per entry
    const t = clean(text); if (t) out.push({ file, text: t, line: lineOf(sf, n), parts });
  };

  // JSX: flat text of a run (A: component boundaries are spaces; B: JSX-style, adjacent pieces glue together)
  const exprText = (e: ts.JsxExpression): string | undefined => { if (!e.expression) return ""; const v = evalValue(e.expression, env); return strOf(v) ?? undefined; };
  const jsxRuns = (el: ts.JsxElement | ts.JsxFragment) => {
    type Piece = { a: string; b: string; unit?: string };
    let run: Piece[] = [];
    const flush = () => {
      const hasText = run.some((p) => p.unit === "text"); const hasOther = run.some((p) => p.unit === "other");
      if (hasText && hasOther) {
        const A = clean(run.map((p) => p.a).join("")), B = clean(run.map((p) => p.b).join(""));
        push(el, A, run.filter((p) => p.unit).map((p) => clean(p.a)).filter(Boolean));
        if (B !== A) push(el, B, run.filter((p) => p.unit).map((p) => clean(p.b)).filter(Boolean));
      }
      run = [];
    };
    const flat = (c: ts.JsxChild): Piece[] | "block" => {
      if (ts.isJsxText(c)) return [{ a: c.text, b: c.text.replace(/\s*\n\s*/g, ""), unit: "text" }];
      if (ts.isJsxExpression(c)) { const t = exprText(c); return [{ a: t ?? "{}", b: t ?? "", unit: t === "" ? undefined : "other" }]; }
      if (ts.isJsxSelfClosingElement(c)) { const tag = c.tagName.getText(sf); return INLINE_TAGS.has(tag) || tag === "br" ? [{ a: " ", b: "" }] : (/^[a-z]/.test(tag) ? "block" : [{ a: " ", b: "" }]); }
      if (ts.isJsxElement(c) || ts.isJsxFragment(c)) {
        const tag = ts.isJsxElement(c) ? c.openingElement.tagName.getText(sf) : "";
        const lower = /^[a-z]/.test(tag);
        if (lower && !INLINE_TAGS.has(tag)) return "block";
        const inner: Piece[] = [];
        for (const cc of c.children) { const f = flat(cc); if (f === "block") return "block"; inner.push(...f); }
        const sep = lower ? "" : " ";
        return [{ a: sep + inner.map((p) => p.a).join("") + sep, b: inner.map((p) => p.b).join(""), unit: "other" }];
      }
      return [];
    };
    for (const c of el.children) {
      const f = flat(c);
      if (f === "block") flush(); else run.push(...f);
    }
    flush();
  };

  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return; // module specifiers / type-level literals are not rendered
    if (ts.isJsxText(n)) { push(n, n.text); return; }
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) jsxRuns(n);
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      // `.join("")` (glue pieces with no separator) that cannot be folded = a string assembled at run time from parts we cannot read.
      const jr = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : undefined;
      const gluesText = !!jr && ((ts.isArrayLiteralExpression(jr) && jr.elements.some((e) => ts.isStringLiteralLike(e) || ts.isTemplateExpression(e))) || (ts.isCallExpression(jr) && ts.isPropertyAccessExpression(unwrap(jr.expression)) && /^(map|filter|concat)$/.test((unwrap(jr.expression) as ts.PropertyAccessExpression).name.text)));
      if (name === "join" && gluesText && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === "" && evalValue(n, env) === undefined) {
        issues.push({ file, line: lineOf(sf, n), text: clean(n.getText(sf)).slice(0, 140) });
      }
      if (OBFUSCATORS.has(name) && evalValue(n, env) === undefined) {
        // `.reverse()` / `.charCodeAt()` on unknown data are common in algorithms; flag only when the receiver chain is string-ish.
        const recv = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : undefined;
        const stringish = !recv || ts.isStringLiteral(recv) || ts.isTemplateExpression(recv) || (ts.isCallExpression(recv) && /^(split|join|map|reverse|concat|slice|replace)$/.test(ts.isPropertyAccessExpression(unwrap(recv.expression)) ? (unwrap(recv.expression) as ts.PropertyAccessExpression).name.text : ""));
        if (stringish && name !== "charCodeAt" && name !== "codePointAt") issues.push({ file, line: lineOf(sf, n), text: clean(n.getText(sf)).slice(0, 140) });
      }
    }
    if (isStringy(n)) {
      const inChain = n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && typeof evalValue(n.parent, env) === "string";
      const calleeOfCall = n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.parent && ts.isCallExpression(n.parent.parent);
      if (!inChain && !calleeOfCall) {
        const v = evalValue(n, env);
        if (typeof v === "string") push(n, v);
        else if (Array.isArray(v) && ts.isCallExpression(n)) { /* arrays are not copy */ }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// -- non-TS user-facing files
function cssUnits(file: string, src: string): Unit[] {
  const t = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: Unit[] = [];
  const unesc = (s: string) => s.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, h) => safeChr(parseInt(h, 16))).replace(/\\(.)/g, "$1");
  for (const m of t.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)) { const text = clean(unesc(m[2])); if (text) out.push({ file, text, line: t.slice(0, m.index).split("\n").length }); }
  return out;
}
function markupUnits(file: string, src: string): Unit[] {
  const out: Unit[] = []; const t = src.replace(/<!--[\s\S]*?-->/g, " ");
  for (const m of t.matchAll(/<(style)[^>]*>([\s\S]*?)<\/\1>/gi)) out.push(...cssUnits(file, m[2]));
  const noCode = t.replace(/<(script|style)[\b][\s\S]*?<\/\1>/gi, " ");
  for (const m of noCode.matchAll(/(?:aria-label|title|alt|content|value|placeholder|label|aria-description)\s*=\s*(["'])(.*?)\1/gi)) { const text = clean(m[2]); if (text) out.push({ file, text, line: noCode.slice(0, m.index).split("\n").length }); }
  for (const m of noCode.matchAll(/>([^<>]+)</g)) { const text = clean(m[1]); if (text) out.push({ file, text, line: noCode.slice(0, m.index).split("\n").length }); }
  return out;
}
function jsonUnits(file: string, src: string): Unit[] {
  const out: Unit[] = [];
  try { const walk = (v: unknown) => { if (typeof v === "string") { const t = clean(v); if (t) out.push({ file, text: t, line: 1 }); } else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(JSON.parse(src)); return out; }
  catch { for (const m of src.matchAll(/"((?:\\.|[^"\\])*)"/g)) { const t = clean(m[1]); if (t) out.push({ file, text: t, line: 1 }); } return out; }
}
function textUnits(file: string, src: string): Unit[] {
  return src.split(/\n\s*\n|\n/).map((l, i) => ({ file, text: clean(l.replace(/^[#>*\-\s`]+/, "")), line: i + 1 })).filter((u) => u.text);
}

export const SCANNED_EXT = /\.(tsx?|jsx?|mjs|cjs|css|svg|html?|json|webmanifest|md|mdx|txt)$/i;

/** All units of one file, whatever its type. `issues` collects unresolved obfuscation. */
export function unitsOf(file: string, source: string, issues: FoldIssue[] = []): Unit[] {
  if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(file)) return extractUnits(file, source, issues);
  if (/\.css$/i.test(file)) return cssUnits(file, source);
  if (/\.(svg|html?)$/i.test(file)) return markupUnits(file, source);
  if (/\.(json|webmanifest)$/i.test(file)) return jsonUnits(file, source);
  return textUnits(file, source);
}

/** Hits for one file (JSX runs only count rules their individual pieces did not already trigger; unresolved obfuscation is a `dynamic-string` hit). */
export function scanSource(file: string, source: string, flags: Flags = { videoUpload: false, contactPlaceholder: true }): Hit[] {
  const issues: FoldIssue[] = [];
  const units = unitsOf(file, source, issues);
  const hits: Hit[] = [];
  for (const u of units) {
    let hs = checkUnit(u, flags);
    if (u.parts && hs.length) {
      const partRules = new Set(u.parts.flatMap((p) => checkUnit({ file, text: p, line: u.line }, flags).map((h) => h.rule)));
      hs = hs.filter((h) => !partRules.has(h.rule));
    }
    hits.push(...hs);
  }
  for (const i of issues) hits.push({ file, line: i.line, text: i.text, rule: "dynamic-string", norm: i.text });
  return hits;
}

/** Flags the rules depend on, read from the (possibly mutated) repo files so a flipped flag changes what is allowed. */
export function readFlags(read: (rel: string) => string | null): Flags {
  const features = read("lib/features.ts") ?? "";
  const contact = read("src/app/contact/page.tsx") ?? "";
  return { videoUpload: /export const VIDEO_UPLOAD\s*=\s*true\b/.test(features), contactPlaceholder: /ComingSoon|Coming soon/i.test(contact) };
}
