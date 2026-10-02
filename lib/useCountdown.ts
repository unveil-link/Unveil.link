"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Wall-clock countdown (robust to throttled timers). `start(seconds)` begins; `remaining` ticks to 0. */
export function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  const deadline = useRef(0);

  const start = useCallback((seconds: number) => {
    deadline.current = Date.now() + seconds * 1000;
    setRemaining(Math.max(0, Math.ceil(seconds)));
  }, []);
  const clear = useCallback(() => {
    deadline.current = 0;
    setRemaining(0);
  }, []);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(left);
    }, 250);
    return () => clearInterval(id);
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return { remaining, start, clear, active: remaining > 0 };
}
