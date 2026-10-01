"use client";
import { forwardRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

/** Password field with a show/hide toggle (toggle is a real button with aria-pressed). */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput(
  props,
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={shown ? "text" : "password"} className="pr-12" {...props} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted hover:text-text"
      >
        {shown ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
      </button>
    </div>
  );
});
