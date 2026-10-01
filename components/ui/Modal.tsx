"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { XIcon } from "./icons";

/** Modal built on the native <dialog> element (focus trap, Esc to close, inert background). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  // The element that had focus when the dialog opened (the trigger); focus goes back to it on close (WCAG 2.4.3).
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Dialogs that are unmounted while open (parents often render `{x && <Dialog open />}`) never fire a native "close"
  // event, so restore focus on unmount too.
  useEffect(() => {
    const d = ref.current;
    return () => {
      const el = returnTo.current;
      if (el && d?.open) requestAnimationFrame(() => { if (el.isConnected) el.focus(); });
    };
  }, []);

  function restoreFocus() {
    const el = returnTo.current;
    returnTo.current = null;
    // Wait a tick: the parent may re-render (e.g. remove the row/button) as part of closing; only restore if the
    // trigger is still in the document, otherwise leave focus to the browser default.
    if (el) requestAnimationFrame(() => { if (el.isConnected) el.focus(); });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => {
        restoreFocus();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface p-0 text-text shadow-pop backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-text"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </dialog>
  );
}
