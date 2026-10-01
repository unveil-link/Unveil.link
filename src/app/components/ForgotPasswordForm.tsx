"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import Link from "next/link";
import { Alert, Button, Field, Input } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { ThrottleNotice } from "@/components/auth/ThrottleNotice";
import { useThrottle } from "@/components/auth/useThrottle";
import { api } from "@/lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const throttle = useThrottle();
  const inputRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const check = (v: string) => (!v.trim() ? "Enter your email address." : !EMAIL_RE.test(v.trim()) ? "Enter a valid email address, like name@example.com." : undefined);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || throttle.locked) return;
    setFormError(null);
    const err = check(email);
    setFieldError(err);
    if (err) return inputRef.current?.focus();
    setBusy(true);
    const res = await api("/api/auth/forgot-password", { method: "POST", json: { email: email.trim() } });
    setBusy(false);
    if (res.ok) return setDone(true);
    if (res.status === 429) return throttle.lock(res.retryAfter ?? 60, res.code);
    setFormError(res.status >= 500 ? "Something went wrong on our side. Please try again in a moment." : res.error);
  }

  if (done) {
    return (
      <AuthShell title="Check your email" footer={<Link className="font-semibold text-primary" href="/login">Back to sign in</Link>}>
        <div data-testid="forgot-done" className="space-y-3">
          <h2 ref={doneRef} tabIndex={-1} className="text-lg font-semibold outline-none">Reset link on its way</h2>
          <p className="text-muted">If an account exists for <b className="text-text">{email.trim()}</b>, we’ve sent a link to reset your password. It’s valid for 1 hour.</p>
          <p className="text-sm text-muted">Nothing in your inbox? Check your spam folder, or try again in a few minutes.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we’ll send you a reset link."
      footer={<Link className="font-semibold text-primary" href="/login">Back to sign in</Link>}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="danger">{formError}</Alert>
          </div>
        )}
        <ThrottleNotice remaining={throttle.remaining} reason={throttle.reason} srMessage={throttle.srMessage} />
        <Field id="email" label="Email" error={fieldError}>
          {(a) => (
            <Input {...a} ref={inputRef} name="email" type="email" inputMode="email" value={email} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com"
              onChange={(e) => { setEmail(e.target.value); if (fieldError) setFieldError(check(e.target.value)); }}
              onBlur={() => email && setFieldError(check(email))} />
          )}
        </Field>
        <Button type="submit" size="lg" loading={busy} disabled={throttle.locked} className="w-full">
          {throttle.locked ? `Try again in ${formatDuration(throttle.remaining)}` : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
