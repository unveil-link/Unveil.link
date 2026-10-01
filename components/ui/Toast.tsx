"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AlertIcon, XIcon } from "./icons";
import { CheckIcon } from "./icons";

type ToastTone = "success" | "danger" | "info";
type ToastItem = { id: number; tone: ToastTone; text: string };
type Ctx = { toast: (text: string, tone?: ToastTone) => void };

const ToastContext = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (text: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((l) => [...l.slice(-3), { id, tone, text }]);
      setTimeout(() => dismiss(id), tone === "danger" ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const toneCls: Record<ToastTone, string> = {
  success: "text-success",
  danger: "text-danger",
  info: "text-primary",
};

/** Presentational stack (also used statically on /design). */
export function ToastViewport({ items, onDismiss, inline }: { items: ToastItem[]; onDismiss?: (id: number) => void; inline?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-2",
        inline ? "" : "pointer-events-none fixed inset-x-4 bottom-24 z-[60] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 lg:bottom-6",
      )}
    >
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 text-sm shadow-pop">
          {t.tone === "success" ? <CheckIcon className={cn("mt-0.5 size-5 shrink-0", toneCls.success)} /> : <AlertIcon className={cn("mt-0.5 size-5 shrink-0", toneCls[t.tone])} />}
          <p className="flex-1 font-medium text-text">{t.text}</p>
          {onDismiss && (
            <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification" className="-m-1 grid size-7 place-items-center rounded text-muted hover:text-text">
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
