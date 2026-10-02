import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AlertIcon, InfoIcon } from "./icons";
import { CheckIcon } from "./icons";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, string> = {
  info: "border-primary/25 bg-primary-soft text-ink",
  success: "border-success/25 bg-success-soft text-ink",
  warning: "border-warning/30 bg-warning-soft text-ink",
  danger: "border-danger/30 bg-danger-soft text-ink",
};
const iconTone: Record<AlertTone, string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: AlertTone;
  title?: ReactNode;
  action?: ReactNode;
};

/** Inline message. `danger` uses role="alert" (assertive); others role="status" (polite). Override with `role`. */
export function Alert({ tone = "info", title, action, className, children, role, ...rest }: AlertProps) {
  const Icon = tone === "success" ? CheckIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn("flex items-start gap-3 rounded-lg border p-3.5 text-sm sm:p-4", tones[tone], className)}
      {...rest}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", iconTone[tone])} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(!!title && "mt-0.5", "text-[0.9375rem] text-ink/85")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
