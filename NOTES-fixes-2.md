# NOTES — backend/fixes-2

Branched from `origin/backend/fixes-1` @ `35f46bc`. Single change: **the per-email login lockout is replaced by progressive delays**, so an attacker can no longer lock the real owner out. Migration `db/migrations/004_fixes_2.sql` is additive (`login_throttle` table; 4 nullable `platform_settings.login_delay_*` columns).

## Why
fixes-1 used the per-email fixed-window limiter (`LOGIN_EMAIL` 10/15 min) as a login lockout: ≥ 10 wrong guesses → 429 for the rest of a 15-min window, *including for the correct password*. Anyone who knew the owner's email could keep them out indefinitely.

## What changed
- `src/server/ratelimit/login-throttle.ts` (new): delay schedule, config resolution, atomic admission, reset.
- `src/app/api/auth/login/route.ts`: `enforceIpLimit("LOGIN_IP")` (unchanged) → `enforceLoginDelay(email)` → `enforceRateLimit("LOGIN_EMAIL")` → verify password → `resetLoginThrottle(email)` on success.
- `src/server/services/password-reset.ts`: completed reset clears the counter (same tx).
- `src/server/ratelimit/index.ts`: `LOGIN_EMAIL` default is now a **burst valve** 20/min (was the 10/15 min lockout); `enforceRateLimit` got an optional `maxWindowSec`, used by login to clamp that window to ≤ the delay cap, so it can never block longer than the cap.
- `scripts/e2e.sh`: starts the app with `LOGIN_DELAY_THRESHOLD=3 BASE=1 CAP=4 DECAY=600` (test speed).

## Delay schedule
Per email (hash of the lower-cased address; unknown emails get rows too, so responses are identical → no enumeration). *f* = recent failures including the one being evaluated, T/B/C = threshold/base/cap (defaults 5/1 s/60 s):

`delay(f) = 0 if f < T else min(C, B · 2^(f−T))` → f=1..4: 0 · f=5: 1 s · 6: 2 s · 7: 4 s · 8: 8 s · 9: 16 s · 10: 32 s · 11+: 60 s.

- Admission is atomic (`SELECT … FOR UPDATE` on the throttle row). An admitted attempt is counted as a failure up-front and arms `next_allowed_at = now() + delay(f)`; a successful login deletes the row. (Counting up-front is what makes parallel guesses safe: N concurrent requests ⇒ only the first T are evaluated, the rest are refused.)
- Attempt before `next_allowed_at` → `429 {code:"login_delayed"}`, `Retry-After` = remaining seconds (ceil, ≤ cap). **Password is not evaluated** (so a correct password during the delay is refused too — no guessing-during-delay bypass). Refused attempts are not counted and do not extend the delay.
- Never permanent: delay ≤ C by construction; DB `CHECK (next_allowed_at <= last_attempt_at + 1 hour)` is a hard backstop (config cap is validated to ≤ 3600); failures are forgotten after `decay` s idle (default 900); success and password reset clear the row.
- Config precedence: `platform_settings.login_delay_{threshold,base_seconds,cap_seconds,decay_seconds}` > env `LOGIN_DELAY_{THRESHOLD,BASE_SECONDS,CAP_SECONDS,DECAY_SECONDS}` > defaults. Invalid values are ignored; base is clamped ≤ cap and decay ≥ cap.
- Unchanged: per-IP `LOGIN_IP` 20/15 min (still returns plain `429 rate_limited`), all other limiters.

## Tests
- `npm test`: 6 files, **31 tests** (was 25 / 5 files): new `tests/login-throttle.test.ts` (schedule table, cap/no-overflow, custom params, config precedence/validation).
- `npm run e2e`: **46/46** (was 41): the old assertion "11th wrong login on one email → 429" was removed from `[#11]` (it asserted the lockout; the title now says "login (per IP)"), and 5 new `[#13]` checks:
  1. 20 concurrent wrong guesses from 20 IPs → exactly 3×401 then 17×429, all `Retry-After` in 1..cap; correct password *during* the delay → 429 and no cookie; after waiting the cap → 200; counter row gone.
  2. Escalation: Retry-After sequence observed `1,2,4,4,4,4` (capped), each attempt after waiting exactly the advertised time is evaluated again; after 9 failures the correct password works after ≤ cap wait (no permanent lock).
  3. Correct login resets the counter (fresh 401,401 then the 3rd arms a delay again; also reset after a post-delay success).
  4. Unknown email: identical 401,401,401,429,… sequence, Retry-After ≤ cap, evaluated again afterwards.
  5. Password reset clears the delay (owner logs in immediately); other emails unaffected; no row exceeds the 1 h bound and the CHECK rejects a 2 h block.

## How to verify
```bash
git checkout backend/fixes-2 && npm ci && npm run migrate   # applies 004
npm test && npm run e2e                                      # 31 tests; 46/46 checks
# manual (defaults): 
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} retry-after=%header{retry-after}\n" -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"wrong-password-1"}' localhost:3000/api/auth/login; sleep 0.2; done
# → 401 ×5, then 429 retry-after=1 … ; wait it out and the right password logs in.
```

## Deviations / caveats
- **Burst limiter default changed** (10/15 min → 20/min): "stays as is" kept literally would have kept the lockout (10/15 min is the lockout). It is still the same fixed-window mechanism, `RATE_LIMIT_LOGIN_EMAIL` still overrides it, but its window is clamped to the delay cap so it cannot lock anyone out. It runs *after* the delay check, so only admitted attempts count.
- **Residual annoyance (inherent to any per-email delay without CAPTCHA/device trust):** an attacker who polls exactly when each delay expires can win the "next slot" race and keep the owner receiving 429s on most tries; the owner is never *blocked* (each wait is ≤ cap and the attempt that follows it is evaluated if they get there first), and password reset always clears the state. CAPTCHA / remembered-device bypass is the intended future hook (README), not built.
- Delay state is DB-backed (works across instances); if the DB is down login fails anyway. The limiter's fail-open behaviour applies only to the generic limiters, not to this table.
- Still deferred as instructed: X-Forwarded-For trust, typecheck, minors.
