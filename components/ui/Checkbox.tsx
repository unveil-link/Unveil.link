import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: ReactNode;
  error?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, className, id, ...rest },
  ref,
) {
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-md py-1.5 text-sm", className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        aria-invalid={error || undefined}
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-border-strong accent-primary"
        {...rest}
      />
      <span className="min-w-0">
        <span className="font-medium text-text">{label}</span>
        {description && <span className="mt-0.5 block text-muted">{description}</span>}
      </span>
    </label>
  );
});
