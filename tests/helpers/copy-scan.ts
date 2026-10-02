import ts from "typescript";

/**
 * Copy-guard scanner. Extracts every USER-VISIBLE-CAPABLE string from a TS/TSX source with the TypeScript parser (not line regexes):
 * JSX text, string literals (JSX attributes such as aria-label / title / alt / placeholder, object fields such as metadata, error messages),
 * no-substitution and substituted template literals (holes become "{}"), and string concatenation / `[...].join("")` of literals
 * (adjacent pieces are joined, so "In" + "stantly" is seen as "Instantly"). Identifiers (icon names such as DownloadIcon), comments and
 * import/export specifiers are NOT strings, so they can never trigger or hide a hit.
 * Each extracted string is normalised (NFKC, zero-width chars removed, HTML entities decoded, whitespace collapsed, lower-cased) and tested
 * against FORBIDDEN, plus a letters-only "squashed" form for the stems in SQUASHED so spacing tricks ("in stant", "down-load") are caught too.
 */
export type Unit = { file: string; text: string; line: number };
export type Hit = Unit & { rule: string; norm: string };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", shy: "", zwnj: "", zwj: "" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}
const safeChr = (n: number) => { try { return String.fromCodePoint(n); } catch { return ""; } };

export function normalize(raw: string): string {
  let s = decodeEntities(raw);
  s = s.normalize("NFKC").replace(/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff]/g, "");
  s = s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/&/g, " and ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
const squash = (norm: string) => norm.replace(/[^a-z]/g, "");

/** [rule name, regex over the normalised string]. Anything legitimate is allowlisted by exact file + exact string (copy-guard.allowlist.ts). */
export const FORBIDDEN: Array<[string, RegExp]> = [
  ["instant", /\binstant(ly|aneous(ly)?)?\b/],
  ["immediate", /\bimmediate(ly)?\b/],
  ["right-away", /\b(right|straight) away\b/],
  ["moment-you-pay", /\b(the )?(very )?moment (you|your|payment)|\bready the moment\b|\bas soon as (you|your|payment|the payment)\b|\bseconds after (you|your|payment)\b/],
  ["receipt", /\breceipts?\b/],
  ["email-promise", /\bemailed\b|\be-?mail (you|them|buyers?) (a |an |the |your )?(receipt|confirmation|files?|download|order|invoice)|\b(send|sends|sending|sent) (you |buyers? |them )?(a |an |the |your )?(receipt|confirmation|order|invoice|download|files?)\b|\bsent to your (e-?mail|inbox)\b/],
  ["inbox", /\binbox\b|\barrive in your\b/],
  ["backup-link", /\bbackup (download )?links?\b/],
  ["auto-deliver", /\bauto(matic(ally)?)?[- ]?(deliver|download|send|unlock)/],
  ["deliver", /\bdeliver(y|ies|ed|s|ing)?\b/],
  ["signed-link", /\bsigned[- ]?(url|link)s?\b/],
  ["pay-and-download", /\bpay (and|&|\+) (download|unlock|get)\b/],
  ["download", /\bdownload(s|ed|ing|able)?\b/],
  ["unlock", /\bunlock(s|ed|ing)?\b/],
  ["trusted-provider", /\btrusted (payment )?(provider|processor|partner)\b|\bpayments? partner\b/],
  ["bank-promise", /\bstraight to your (bank|account)\b|\bto your bank\b|\bbank (account|transfer|deposit)s?\b|\bpayouts? (are |is |will be )?(sent|paid|deposited|made) (daily|weekly|monthly|automatically|on a)\b|\bregular schedule\b/],
  ["verified-claims", /\b(identity|age)[- ](and |& )?(age|identity)?[- ]?verif|\bage[- ]verified\b|\bidentity[- ]verified\b|\bkyc\b/],
  ["private-to-creator", /\bprivate to (the )?(creator|seller)\b/],
  ["video-live", /\bvideos?\b(?!\/)/],
];
/** Letters-only stems (spacing / punctuation tricks such as "in stant", "down-load", "re.ceipt"). */
const SQUASHED: Array<[string, string]> = [
  ["instant", "instant"], ["immediate", "immediate"], ["receipt", "receipt"], ["download", "download"], ["right-away", "rightaway"],
  ["signed-link", "signedlink"], ["backup-link", "backuplink"], ["inbox", "inbox"], ["auto-deliver", "autodeliver"], ["pay-and-download", "payanddownload"],
];

function lineOf(sf: ts.SourceFile, node: ts.Node) { return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1; }

/** Joined text of a pure string expression (literals, templates, `+`, `[..].join("")`, parens, `as const`); holes -> "{}". null if it holds no literal at all. */
function joined(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) return joined(n.expression);
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((sp) => "{}" + sp.literal.text).join("");
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = joined(n.left), r = joined(n.right);
    if (l === null && r === null) return null;
    return (l ?? "{}") + (r ?? "{}");
  }
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "join" && ts.isArrayLiteralExpression(n.expression.expression)) {
    const sepArg = n.arguments[0]; const sep = sepArg ? joined(sepArg) : ",";
    const raw = n.expression.expression.elements.map((e) => joined(e));
    if (raw.every((x) => x === null)) return null;
    return raw.map((x) => x ?? "{}").join(sep ?? "");
  }
  return null;
}

const isStringy = (n: ts.Node) =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) ||
  (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
  (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "join");

export function extractUnits(file: string, source: string): Unit[] {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out: Unit[] = [];
  const push = (n: ts.Node, text: string) => { const t = text.replace(/\s+/g, " ").trim(); if (t) out.push({ file, text: t, line: lineOf(sf, n) }); };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return; // module specifiers / type-level literals are not rendered
    if (ts.isJsxText(n)) { push(n, n.text); return; }
    if (isStringy(n)) {
      const inChain = n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && joined(n.parent) !== null;
      const j = inChain ? null : joined(n);
      if (j !== null) push(n, j);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function checkUnit(u: Unit): Hit[] {
  const norm = normalize(u.text);
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const [rule, re] of FORBIDDEN) if (re.test(norm)) { seen.add(rule); hits.push({ ...u, rule, norm }); }
  const sq = squash(norm);
  for (const [rule, stem] of SQUASHED) if (!seen.has(rule) && sq.includes(stem) && !norm.includes(stem)) hits.push({ ...u, rule: rule + " (spacing trick)", norm });
  return hits;
}

export const scanSource = (file: string, source: string): Hit[] => extractUnits(file, source).flatMap(checkUnit);
