import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Horizontally scrollable wrapper + table. Pass `caption` for an accessible name. */
export function Table({ className, caption, children, ...rest }: HTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
      <table className={cn("w-full min-w-[40rem] border-collapse text-left text-sm", className)} {...rest}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className="border-b border-border bg-surface-muted/60" {...p} />
);
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="divide-y divide-border" {...p} />;
export const Tr = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("transition-colors hover:bg-surface-muted/40", className)} {...p} />
);
export const Th = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn("px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted", className)} {...p} />
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-4 py-3.5 align-middle text-text", className)} {...p} />
);
