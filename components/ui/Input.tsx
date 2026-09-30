import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const controlClasses =
  "w-full rounded-md border border-border-strong bg-surface px-3.5 text-base text-text placeholder:text-muted " +
  "transition-shadow focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[var(--shadow-focus)] " +
  "disabled:bg-surface-muted disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(198_40_40/0.25)]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(controlClasses, "h-11", className)} {...rest} />;
});
