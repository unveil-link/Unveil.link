import { Alert } from "@/components/ui";
import { ClockIcon } from "@/components/ui/icons";

/** Visible countdown (aria-hidden ticks) + a single polite live region for assistive tech. */
export function ThrottleNotice({ remaining, reason, srMessage }: { remaining: number; reason: "login_delayed" | "rate_limited" | null; srMessage: string }) {
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {srMessage}
      </p>
      {remaining > 0 && (
        <Alert tone="warning" role="presentation" data-testid="throttle-notice">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{reason === "login_delayed" ? "Too many sign-in attempts" : "You’re going a little fast"}</p>
              <p className="mt-0.5">
                {reason === "login_delayed"
                  ? "For your security, sign-in is paused briefly after repeated failed attempts."
                  : "We’ve paused this form for a moment to keep things safe."}
              </p>
            </div>
            <div aria-hidden="true" className="flex shrink-0 flex-col items-center rounded-md bg-white/70 px-3 py-1.5 text-warning">
              <ClockIcon className="size-4" />
              <span className="text-lg font-bold leading-tight tabular-nums" data-testid="countdown">{remaining}s</span>
            </div>
          </div>
        </Alert>
      )}
    </>
  );
}
