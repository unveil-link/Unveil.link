import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center sm:py-14", className)}>
      {icon && <span className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft text-primary [&>svg]:size-7">{icon}</span>}
      <h3 className="text-lg font-semibold text-text">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
