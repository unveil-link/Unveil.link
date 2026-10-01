import { pool, queryOne } from "../db";
import { getSettings } from "../services/settings";
import { expirePendingCheckouts } from "./checkout";
import { retryVoidRefunds, type VoidRetryResult } from "./refunds";
import { retryParkedEvents } from "./webhooks";

/**
 * Payments janitor: the one scheduled-cleanup entry point (HTTP cron route, CLI script, tests). Idempotent: every step only touches rows
 * that still need it, so running it twice in a row (or overlapping) never double-processes. Overlap is prevented with a session-level
 * Postgres advisory lock held on a dedicated connection for the whole run; a second concurrent run returns `{ skipped: true }`.
 *
 * Steps (none of them touches money math; they only call existing, already-tested service functions):
 *   1. expirePendingCheckouts()  - pending sessions older than checkout_session_ttl_minutes -> failed/session_expired
 *   2. retryVoidRefunds()        - re-ask the provider for void refunds that failed (cap + exponential backoff, last error kept)
 *   3. retryParkedEvents()       - apply parked refunds/chargebacks whose sale has since succeeded (normally a no-op)
 *   4. flag stale parked events  - parked for longer than parked_event_stale_hours with the sale still missing: stamp
 *                                  webhook_events.stale_flagged_at (never deleted, never re-applied) so ops can reconcile with the processor
 * A heartbeat (payments_janitor_state) is written on every run; an audit_log row (action `payments_janitor_run`) is written whenever
 * a run actually did something or hit a problem, so quiet 5-minute ticks don't flood the audit log.
 */
const LOCK_KEY = "payments:janitor";

export interface JanitorCounts {
  expiredCheckouts: number;
  voidRefundsRequested: number;
  voidRefundsFailed: number;
  voidRefundsGaveUp: number;
  parkedEventsApplied: number;
  parkedEventsFlaggedStale: number;
}
export type JanitorResult =
  | { skipped: true; reason: "already_running" }
  | { skipped: false; counts: JanitorCounts; errors: string[]; durationMs: number };

export async function flagStaleParkedEvents(): Promise<number> {
  const { parked_event_stale_hours: hours } = await getSettings();
  const r = await pool().query(
    `UPDATE webhook_events w SET stale_flagged_at = now()
      WHERE w.outcome = 'parked' AND w.stale_flagged_at IS NULL AND w.received_at < now() - make_interval(hours => $1::int)`, [hours]);
  return r.rowCount ?? 0;
}

export async function runPaymentsJanitor(): Promise<JanitorResult> {
  const started = Date.now();
  const lock = await pool().connect();
  let locked = false;
  try {
    const got = await lock.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`, [LOCK_KEY]);
    locked = got.rows[0].ok;
    if (!locked) return { skipped: true, reason: "already_running" };

    const errors: string[] = [];
    const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (e) { errors.push(`${name}: ${String((e as Error).message ?? e).slice(0, 200)}`); console.error(`payments janitor step ${name} failed`, e); return fallback; }
    };
    const expired = await step("expire_checkouts", () => expirePendingCheckouts(), 0);
    const voids = await step<VoidRetryResult>("retry_void_refunds", () => retryVoidRefunds(), { requested: 0, failed: 0, gaveUp: 0 });
    const parkedApplied = await step("retry_parked_events", () => retryParkedEvents(), 0);
    const stale = await step("flag_stale_parked", () => flagStaleParkedEvents(), 0);
    const counts: JanitorCounts = {
      expiredCheckouts: expired, voidRefundsRequested: voids.requested, voidRefundsFailed: voids.failed, voidRefundsGaveUp: voids.gaveUp,
      parkedEventsApplied: parkedApplied, parkedEventsFlaggedStale: stale,
    };
    const durationMs = Date.now() - started;
    // `gaveUp` is a standing condition (rows stay in that state), so it alone doesn't make every run "noteworthy".
    const didSomething = expired + voids.requested + voids.failed + parkedApplied + stale > 0 || errors.length > 0;
    await lock.query(
      `UPDATE payments_janitor_state SET last_run_at = now(), last_counts = $1::jsonb, runs = runs + 1 WHERE id = 1`, [JSON.stringify({ ...counts, errors })]);
    if (didSomething) {
      await lock.query(`INSERT INTO audit_log (admin_id, action, target) VALUES (NULL, 'payments_janitor_run', $1)`,
        [`counts ${JSON.stringify(counts)}${errors.length ? ` errors ${JSON.stringify(errors)}` : ""}`.slice(0, 1000)]);
    }
    return { skipped: false, counts, errors, durationMs };
  } finally {
    if (locked) await lock.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [LOCK_KEY]).catch(() => {});
    lock.release();
  }
}

/** Last heartbeat (for ops/admin visibility). */
export const getJanitorState = () =>
  queryOne<{ last_run_at: string | null; last_counts: unknown; runs: string }>(`SELECT last_run_at, last_counts, runs FROM payments_janitor_state WHERE id = 1`);
