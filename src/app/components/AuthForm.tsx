"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, buttonClasses, Field, Input } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { ThrottleNotice } from "@/components/auth/ThrottleNotice";
import { useThrottle } from "@/components/auth/useThrottle";
import { api } from "@/lib/api";
import { PASSWORD_MAX, passwordRules } from "@/lib/password-hint";

type Mode = "signup" | "login";
type Errors = Partial<Record<"displayName" | "email" | "password", string>>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
};

function validate(mode: Mode, v: { displayName: string; email: string; password: string }): Errors {
  const e: Errors = {};
  if (mode === "signup" && !v.displayName.trim()) e.displayName = "Enter the name buyers will see.";
  if (!v.email.trim()) e.email = "Enter your email address.";
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email address, like name@example.com.";
  if (!v.password) e.password = mode === "signup" ? "Create a password." : "Enter your password.";
  else if (mode === "signup") {
    if (v.password.length > PASSWORD_MAX) e.password = `Password must be at most ${PASSWORD_MAX} characters.`;
    else {
      const bad = passwordRules(v.password, v).find((r) => !r.ok);
      if (bad) e.password = bad.id === "length" ? "Password must be at least 10 characters." : `Choose a different password — ${bad.label.toLowerCase()}.`;
    }
  }
  return e;
}

export default function AuthForm({ mode, googleEnabled }: { mode: Mode; googleEnabled: boolean }) {
  const router = useRouter();
  const qs = useSearchParams();
  const oauthErr = qs.get("error");
  const [vals, setVals] = useState({ displayName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(oauthErr ? OAUTH_ERRORS[oauthErr] ?? "Sign-in with Google didn’t work. Please try again or use your email." : null);
  const [busy, setBusy] = useState(false);
  const [rejectedPw, setRejectedPw] = useState<string | null>(null);
  const throttle = useThrottle();
  const formErrorRef = useRef<HTMLDivElement>(null);
  const refs = {
    displayName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  const isSignup = mode === "signup";
  const set = (k: keyof typeof vals) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...vals, [k]: e.target.value };
    setVals(next);
    if (touched[k] || errors[k]) setErrors((cur) => ({ ...cur, [k]: validate(mode, next)[k] }));
  };
  const blur = (k: keyof typeof vals) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors((cur) => ({ ...cur, [k]: validate(mode, vals)[k] }));
  };

  // Move focus to the summary whenever a form-level error appears (so keyboard + screen-reader users land on it).
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  function focusFirst(errs: Errors) {
    const first = (["displayName", "email", "password"] as const).find((k) => errs[k]);
    if (first) refs[first].current?.focus();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || throttle.locked) return;
    setFormError(null);
    const errs = validate(mode, vals);
    setErrors(errs);
    setTouched({ displayName: true, email: true, password: true });
    if (Object.keys(errs).length) return focusFirst(errs);

    setBusy(true);
    const body = isSignup
      ? { displayName: vals.displayName.trim(), email: vals.email.trim(), password: vals.password }
      : { email: vals.email.trim(), password: vals.password };
    const res = await api(`/api/auth/${mode}`, { method: "POST", json: body });
    setBusy(false);

    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    if (res.status === 429) {
      throttle.lock(res.retryAfter ?? 30, res.code);
      return;
    }
    if (res.network) return setFormError(res.error);
    if (res.code === "weak_password") {
      setRejectedPw(vals.password);
      setErrors({ password: res.error });
      return refs.password.current?.focus();
    }
    if (res.code === "email_taken") {
      setErrors({ email: "An account with this email already exists." });
      return refs.email.current?.focus();
    }
    if (res.code === "invalid_credentials") {
      setVals((v) => ({ ...v, password: "" }));
      return setFormError("That email and password don’t match. Check them and try again, or reset your password.");
    }
    if (res.code === "bad_origin") return setFormError("This request was blocked for your safety. Reload the page and try again.");
    if (res.status >= 500) return setFormError("Something went wrong on our side. Please try again in a moment.");
    setFormError(res.error);
  }

  const locked = throttle.locked;
  const submitLabel = locked
    ? `Try again in ${throttle.remaining}s`
    : isSignup
      ? "Create account"
      : "Sign in";

  return (
    <AuthShell
      title={isSignup ? "Create your seller account" : "Welcome back"}
      subtitle={isSignup ? "Set up in a minute. Start sharing paid links today." : "Sign in to manage your drops and earnings."}
      footer={
        isSignup ? (
          <>Already have an account? <Link className="font-semibold text-primary" href="/login">Sign in</Link></>
        ) : (
          <>New to Unveil? <Link className="font-semibold text-primary" href="/signup">Create an account</Link></>
        )
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-describedby={formError ? "form-error" : undefined}>
        {formError && (
          <div ref={formErrorRef} tabIndex={-1} id="form-error" className="outline-none" data-testid="form-error">
            <Alert tone="danger" role="alert">{formError}</Alert>
          </div>
        )}
        <ThrottleNotice remaining={throttle.remaining} reason={throttle.reason} srMessage={throttle.srMessage} />

        {isSignup && (
          <Field id="displayName" label="Display name" help="Shown to buyers on your payment links." error={errors.displayName}>
            {(a) => (
              <Input {...a} ref={refs.displayName} name="displayName" value={vals.displayName} onChange={set("displayName")} onBlur={blur("displayName")} maxLength={80} autoComplete="nickname" placeholder="Maya Lin" />
            )}
          </Field>
        )}
        <Field id="email" label="Email" error={errors.email}>
          {(a) => (
            <Input {...a} ref={refs.email} name="email" type="email" inputMode="email" value={vals.email} onChange={set("email")} onBlur={blur("email")} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" />
          )}
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          {(a) => (
            <PasswordInput
              {...a}
              ref={refs.password}
              name="password"
              value={vals.password}
              onChange={set("password")}
              onBlur={blur("password")}
              autoComplete={isSignup ? "new-password" : "current-password"}
              aria-describedby={[a["aria-describedby"], isSignup ? "pw-strength" : ""].filter(Boolean).join(" ") || undefined}
            />
          )}
        </Field>
        {isSignup && <PasswordStrength id="pw-strength" password={vals.password} email={vals.email} displayName={vals.displayName} rejected={rejectedPw !== null && rejectedPw === vals.password} />}
        {!isSignup && (
          <p className="-mt-1 text-sm">
            <Link className="font-medium text-primary" href="/forgot-password">Forgot your password?</Link>
          </p>
        )}

        <Button type="submit" size="lg" loading={busy} disabled={locked} className="w-full" aria-disabled={locked || undefined}>
          {submitLabel}
        </Button>
        {isSignup && (
          <p className="text-center text-xs text-muted">
            By creating an account you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        )}

        {googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <a href="/api/auth/google" className={buttonClasses("secondary", "lg", "w-full")}>Continue with Google</a>
          </>
        )}
      </form>
    </AuthShell>
  );
}
