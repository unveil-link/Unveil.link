import type { Hit } from "./copy-scan";
import type { Allow } from "../copy-guard.allowlist";

export const key = (a: { file: string; text: string }) => `${a.file}\u0000${a.text}`;
/** Occurrences of one string in one file = the highest per-rule hit count (so one string tripping two rules still counts once). */
export function counts(hits: Hit[]): Map<string, number> {
  const per = new Map<string, number>();
  for (const h of hits) per.set(`${key(h)}\u0000${h.rule}`, (per.get(`${key(h)}\u0000${h.rule}`) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const [k, n] of per) { const base = k.slice(0, k.lastIndexOf("\u0000")); out.set(base, Math.max(out.get(base) ?? 0, n)); }
  return out;
}
export function violations(hits: Hit[], list: Allow[]): Hit[] {
  const allowed = new Map(list.map((a) => [key(a), a.count ?? 1]));
  const c = counts(hits);
  return hits.filter((h) => !allowed.has(key(h)) || c.get(key(h))! > allowed.get(key(h))!);
}

/** Payout copy numbers (FAQ / dashboard hints) are pinned to the backend defaults (platform_settings). Returns the problems, [] if consistent. */
export function featurePinProblems(featuresSrc: string): string[] {
  const out: string[] = [];
  if (Number(featuresSrc.match(/export const PAYOUT_HOLD_DAYS\s*=\s*(\d+)/)?.[1]) !== 7) out.push("PAYOUT_HOLD_DAYS must equal the backend default payout_hold_days = 7 (copy says '7-day hold')");
  if (Number(featuresSrc.match(/export const MIN_PAYOUT_USD\s*=\s*(\d+)/)?.[1]) !== 25) out.push("MIN_PAYOUT_USD must equal the backend default min_payout_cents = 2500 (copy says '$25')");
  return out;
}
