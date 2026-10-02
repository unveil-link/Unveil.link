import { cn } from "@/lib/cn";

type ProgressProps = {
  value: number; // 0-100
  label: string; // accessible name
  tone?: "primary" | "success" | "danger";
  indeterminate?: boolean;
  className?: string;
};
const fill = { primary: "bg-primary", success: "bg-success", danger: "bg-danger" } as const;

export function Progress({ value, label, tone = "primary", indeterminate, className }: ProgressProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : v}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-200", fill[tone], indeterminate && "w-1/3 animate-pulse")}
        style={indeterminate ? undefined : { width: `${v}%` }}
      />
    </div>
  );
}
