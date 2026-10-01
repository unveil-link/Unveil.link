import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./Card";
import { Skeleton } from "./Skeleton";

type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "primary" | "accent";
  loading?: boolean;
  className?: string;
};
const iconTones = {
  default: "bg-surface-muted text-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-[#0b5e55]",
} as const;

export function StatCard({ label, value, hint, icon, tone = "default", loading, className }: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-3 !p-4 sm:!p-5", className)} aria-busy={loading || undefined}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <span className={cn("grid size-9 place-items-center rounded-md [&>svg]:size-5", iconTones[tone])}>{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <p className="text-2xl font-bold tracking-tight text-text tabular-nums sm:text-3xl">{value}</p>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}
