import { config } from "../config";
import { query, queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { hashKeyPart } from ".";

/**
 * Progressive login delays — replaces the old per-email lockout.
 *
 * State per email (hashed; unknown emails included, so there is no enumeration signal):
 *   failures        recent failed attempts
 *   next_allowed_at the earliest moment the next attempt may be EVALUATED
 *
 * Schedule (threshold T, base B, cap C; defaults 5 / 1 s / 60 s):
 *   delay after the f-th recent failure = 0                      if f < T
 *                                       = min(C, B * 2^(f - T))  if f >= T
 *   => failures 1..4: no delay; 5th: 1 s; 6th: 2 s; 7th: 4 s; 8th: 8 s; ... 11th and later: 60 s.
 *
 * Guarantees:
 *   - An attempt arriving before `next_allowed_at` is answered 429 + Retry-After (= remaining seconds)
 *     WITHOUT looking at the password, so a correct guess made during a delay is not a bypass.
 *     Such rejected attempts do NOT count as failures and do NOT extend the delay.
 *   - The delay is never longer than the cap (and the DB CHECK caps it at 1 h whatever the config says),
 *     and the counter forgets failures after `decay` seconds without an attempt, so there is no lockout:
 *     the owner can always log in after waiting out <= cap seconds. A correct login (and a password
 *     reset) deletes the row.
 *   - Admission is atomic (row lock): N parallel guesses cannot all slip through the same window.
 *     An admitted attempt is counted as a failure up front and the row is deleted if it turns out to be
 *     correct; that is what makes the check race-free.
 */
export interface LoginDelayConfig {
  /** failures before the first delay kicks in (>= 1) */
  threshold: number;
  baseSec: number;
  capSec: number;
  /** failures are forgotten after this many seconds without an attempt (>= capSec) */
  decaySec: number;
}

export const DEFAULT_LOGIN_DELAY: LoginDelayConfig = { threshold: 5, baseSec: 1, capSec: 60, decaySec: 900 };
export const MAX_LOGIN_DELAY_CAP_SEC = 3600; // mirrors the CHECK constraints in migration 004

/** Delay (seconds) imposed after the `failures`-th recent failed attempt. Pure; unit-tested. */
export function loginDelaySeconds(failures: number, c: LoginDelayConfig): number {
  if (failures < c.threshold) return 0;
  const exp = Math.min(failures - c.threshold, 30);
  return Math.min(c.capSec, c.baseSec * 2 ** exp);
}

const posInt = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** Precedence: platform_settings row > env LOGIN_DELAY_* > defaults. Invalid values are ignored. */
export function resolveLoginDelayConfig(
  row: Partial<Record<"login_delay_threshold" | "login_delay_base_seconds" | "login_delay_cap_seconds" | "login_delay_decay_seconds", number | null>> | null,
  env: Record<string, string | undefined>,
): LoginDelayConfig {
  const d = DEFAULT_LOGIN_DELAY;
  const threshold = posInt(row?.login_delay_threshold, 1, 100) ?? posInt(env.LOGIN_DELAY_THRESHOLD, 1, 100) ?? d.threshold;
  const baseSec = posInt(row?.login_delay_base_seconds, 1, MAX_LOGIN_DELAY_CAP_SEC) ?? posInt(env.LOGIN_DELAY_BASE_SECONDS, 1, MAX_LOGIN_DELAY_CAP_SEC) ?? d.baseSec;
  const capSec = posInt(row?.login_delay_cap_seconds, 1, MAX_LOGIN_DELAY_CAP_SEC) ?? posInt(env.LOGIN_DELAY_CAP_SECONDS, 1, MAX_LOGIN_DELAY_CAP_SEC) ?? d.capSec;
  const decay = posInt(row?.login_delay_decay_seconds, 1, 86400) ?? posInt(env.LOGIN_DELAY_DECAY_SECONDS, 1, 86400) ?? d.decaySec;
  return { threshold, baseSec: Math.min(baseSec, capSec), capSec, decaySec: Math.max(decay, capSec) };
}

export async function getLoginDelayConfig(): Promise<LoginDelayConfig> {
  const row = await queryOne<{
    login_delay_threshold: number | null; login_delay_base_seconds: number | null;
    login_delay_cap_seconds: number | null; login_delay_decay_seconds: number | null;
  }>("SELECT login_delay_threshold, login_delay_base_seconds, login_delay_cap_seconds, login_delay_decay_seconds FROM platform_settings WHERE id = 1");
  return resolveLoginDelayConfig(row, process.env);
}

export const loginThrottleKey = (email: string) => `login:${hashKeyPart(email)}`;

export type Admission = { admitted: true; failures: number; delaySec: number } | { admitted: false; retryAfterSec: number };

/**
 * Atomically decides whether an attempt for `email` may be evaluated now. If admitted it is already
 * counted as a failure (see header) and the next delay is armed; call `resetLoginThrottle` on success.
 */
export async function admitLoginAttempt(email: string, cfg?: LoginDelayConfig): Promise<Admission> {
  const c = cfg ?? (await getLoginDelayConfig());
  const key = loginThrottleKey(email);
  const out = await withTx(async (tx) => {
    await tx.query("INSERT INTO login_throttle (key, failures) VALUES ($1, 0) ON CONFLICT (key) DO NOTHING", [key]);
    const { rows } = await tx.query<{ failures: number; stale: boolean; wait: number }>(
      `SELECT failures,
              last_attempt_at < now() - make_interval(secs => $2) AS stale,
              ceil(extract(epoch FROM (next_allowed_at - now())))::int AS wait
         FROM login_throttle WHERE key = $1 FOR UPDATE`,
      [key, c.decaySec],
    );
    const r = rows[0];
    if (r.wait > 0) return { admitted: false, retryAfterSec: Math.min(r.wait, c.capSec) } as const;
    const failures = r.stale ? 1 : r.failures + 1;
    const delaySec = loginDelaySeconds(failures, c);
    await tx.query(
      `UPDATE login_throttle
          SET failures = $2, last_attempt_at = now(), next_allowed_at = now() + make_interval(secs => $3)
        WHERE key = $1`,
      [key, failures, delaySec],
    );
    return { admitted: true, failures, delaySec } as const;
  });
  if (Math.random() < 0.01) {
    query("DELETE FROM login_throttle WHERE last_attempt_at < now() - interval '1 day'").catch(() => {});
  }
  return out;
}

/** Forget an email's failures (successful login, completed password reset). */
export async function resetLoginThrottle(email: string, exec?: { query: (sql: string, p: unknown[]) => Promise<unknown> }) {
  const sql = "DELETE FROM login_throttle WHERE key = $1";
  const p = [loginThrottleKey(email)];
  if (exec) await exec.query(sql, p);
  else await query(sql, p);
}

/** Route helper: throws 429 + Retry-After when the email is in a delay window; no-op when rate limiting is disabled. */
export async function enforceLoginDelay(email: string): Promise<void> {
  if (!config.rateLimitEnabled) return;
  const a = await admitLoginAttempt(email);
  if (!a.admitted) {
    throw new HttpError(
      429,
      `Too many failed sign-in attempts. Please wait ${a.retryAfterSec} second${a.retryAfterSec === 1 ? "" : "s"} and try again.`,
      "login_delayed",
      { "Retry-After": String(a.retryAfterSec) },
    );
  }
}
