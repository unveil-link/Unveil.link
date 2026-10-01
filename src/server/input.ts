import { HttpError } from "./errors";

/**
 * Shared input hygiene. Postgres `text`/`jsonb` reject U+0000 ("invalid byte sequence for encoding UTF8: 0x00") and `uuid` columns
 * reject anything that is not a real UUID; both used to surface as an unhandled 500 (and, for processors, an endless retry loop).
 * Everything that comes from outside goes through one of these before it reaches SQL.
 */

/** Strict RFC-4122-shaped UUID (8-4-4-4-12 hex). NOT `/^[0-9a-f-]{36}$/`, which also accepts 36 dashes and would reach Postgres. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** True when the string contains U+0000 or a lone surrogate (not valid, storable text). */
export const hasBadText = (s: string): boolean => s.includes("\u0000") || !s.isWellFormed();

/** Max nesting we are willing to inspect (request bodies here are flat objects). */
const MAX_DEPTH = 8;

/**
 * Walks a parsed JSON value and throws 400 `invalid_input` if any string (key or value) contains NUL or a lone surrogate, or the
 * structure is absurdly deep. Called for EVERY JSON request body from `jsonBody()`, so no route can forget it.
 */
export function assertCleanJson(v: unknown, depth = 0): void {
  if (typeof v === "string") {
    if (hasBadText(v)) throw new HttpError(400, "Input contains invalid characters", "invalid_input");
  } else if (Array.isArray(v)) {
    if (depth >= MAX_DEPTH) throw new HttpError(400, "Input is nested too deeply", "invalid_input");
    for (const x of v) assertCleanJson(x, depth + 1);
  } else if (v && typeof v === "object") {
    if (depth >= MAX_DEPTH) throw new HttpError(400, "Input is nested too deeply", "invalid_input");
    for (const [k, x] of Object.entries(v)) {
      if (hasBadText(k)) throw new HttpError(400, "Input contains invalid characters", "invalid_input");
      assertCleanJson(x, depth + 1);
    }
  }
}

/** For free text that is NOT going through jsonBody (query strings, headers, CLI args): trim, bound the length, reject bad chars. */
export function cleanText(s: string | null | undefined, max: number, what = "value"): string {
  const t = (s ?? "").trim();
  if (t.length > max) throw new HttpError(400, `${what} is too long`, "invalid_input");
  if (hasBadText(t)) throw new HttpError(400, `${what} contains invalid characters`, "invalid_input");
  return t;
}

/** Best-effort sanitiser for text that must be STORED but must never fail the write (log/audit detail): NUL/lone surrogates -> U+FFFD, truncated. */
export const sanitizeForStorage = (s: string, max = 300): string => s.replace(/\u0000/g, "\uFFFD").toWellFormed().slice(0, max);
