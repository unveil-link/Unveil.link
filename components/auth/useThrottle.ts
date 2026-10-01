"use client";
import { useEffect, useRef, useState } from "react";
import { formatDurationLong } from "@/lib/format";
import { useCountdown } from "@/lib/useCountdown";

/**
 * Handles 429 responses for a form: starts a countdown from Retry-After, exposes `locked` (disable submit)
 * and a one-shot screen-reader message (set when the lock starts and when it ends) so assistive tech isn't
 * spammed every second.
 */
export function useThrottle() {
  const cd = useCountdown();
  const [reason, setReason] = useState<"login_delayed" | "rate_limited" | null>(null);
  const [srMessage, setSrMessage] = useState("");
  const was = useRef(false);

  useEffect(() => {
    if (was.current && !cd.active) {
      setSrMessage("You can try again now.");
      setReason(null);
    }
    was.current = cd.active;
  }, [cd.active]);

  function lock(seconds: number, code?: string) {
    setReason(code === "login_delayed" ? "login_delayed" : "rate_limited");
    setSrMessage(`Too many attempts. You can try again in ${formatDurationLong(seconds)}.`);
    cd.start(seconds);
  }

  return { remaining: cd.remaining, locked: cd.active, reason, srMessage, lock, clearSr: () => setSrMessage("") };
}
