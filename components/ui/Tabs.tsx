"use client";
import { useRef } from "react";
import { cn } from "@/lib/cn";

export type TabItem = { id: string; label: string; count?: number };

/**
 * Accessible tab strip (role=tablist, arrow-key navigation). Controlled: pass `value` + `onChange`.
 * The consumer renders the panel and should give it `id={`${idBase}-panel`}` + `role="tabpanel"` + `aria-labelledby={`${idBase}-tab-${value}`}`.
 */
export function Tabs({
  items,
  value,
  onChange,
  idBase,
  label,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  label: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKey(e: React.KeyboardEvent, i: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[items[next].id]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
      {items.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={`${idBase}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`${idBase}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-semibold transition-colors",
              active ? "border-primary text-primary" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-primary-soft text-primary-hover" : "bg-surface-muted text-muted")}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
