"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, Button, ButtonLink, Field } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { ThrottleNotice } from "@/components/auth/ThrottleNotice";
import { useThrottle } from "@/components/auth/useThrottle";
import { api } from "@/lib/api";
import { PASSWORD_MAX, passwordRules } from "@/lib/password-hint";

export default function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectedPw, setRejectedPw] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const throttle = useThrottle();
  const pwRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]);
  useEffect(() => { if (formError) alertRef.current?.focus(); }, [formError]);

  const check = (v: string) => {
    if (!v) return "Create a new password.";
    if (v.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
    const bad = passwordRules(v).find((r) => !r.ok);
    return bad ? (bad.id === "length" ? "Password must be at least 10 characters." : `Choose a different password — ${bad.label.toLowerCase()}.`) : undefined;
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || throttle.locked) return;
    setFormError(null);
    const err = check(password);
    setFieldError(err);
    if (err) return pwRef.current?.focus();
    setBusy(true);
    const res = await api("/api/auth/reset-password", { method: "POST", json: { token, password } });
    setBusy(false);
    if (res.ok) return setDone(true);
    if (res.status === 429) return throttle.lock(res.retryAfter ?? 60, res.code);
    if (res.code === "weak_password") { setRejectedPw(password); setFieldError(res.error); return pwRef.current?.focus(); }
    if (res.code === "invalid_token") return setExpired(true);
    setFormError(res.status >= 500 ? "Something went wrong on our side. Please try again in a moment." : res.error);
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <div data-testid="reset-done" className="space-y-4">
          <h2 ref={doneRef} tabIndex={-1} className="text-lg font-semibold outline-none">You’re all set</h2>
          <p className="text-muted">You’ve been signed out everywhere. Sign in with your new password.</p>
          <ButtonLink href="/login" size="lg" className="w-full">Sign in</ButtonLink>
        </div>
      </AuthShell>
    );
  }
  if (!token || expired) {
    return (
      <AuthShell title={expired ? "Link expired" : "Invalid link"}>
        <div className="space-y-4">
          <p className="text-muted">
            {expired ? "This reset link is invalid, already used, or has expired." : "This reset link is missing its token."} Reset links are valid for 1 hour and work once.
          </p>
          <ButtonLink href="/forgot-password" size="lg" className="w-full">Request a new link</ButtonLink>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="You’ll be signed out of all devices after changing it." footer={<Link className="font-semibold text-primary" href="/login">Back to sign in</Link>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <div ref={alertRef} tabIndex={-1} className="outline-none"><Alert tone="danger">{formError}</Alert></div>
        )}
        <ThrottleNotice remaining={throttle.remaining} reason={throttle.reason} srMessage={throttle.srMessage} />
        <Field id="password" label="New password" error={fieldError}>
          {(a) => (
            <PasswordInput {...a} ref={pwRef} name="password" value={password} autoComplete="new-password"
              aria-describedby={[a["aria-describedby"], "pw-strength"].filter(Boolean).join(" ")}
              onChange={(e) => { setPassword(e.target.value); if (fieldError) setFieldError(check(e.target.value)); }} />
          )}
        </Field>
        <PasswordStrength id="pw-strength" password={password} rejected={rejectedPw !== null && rejectedPw === password} />
        <Button type="submit" size="lg" loading={busy} disabled={throttle.locked} className="w-full">
          {throttle.locked ? `Try again in ${formatDuration(throttle.remaining)}` : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
