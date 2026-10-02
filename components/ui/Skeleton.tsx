import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Loading placeholder. Decorative: hide from AT; put aria-busy on the container. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-border/70", className)} {...rest} />;
}
