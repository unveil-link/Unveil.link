"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonClasses, Card, CardTitle, Field, Input } from "@/components/ui";

export default function AuthForm({ mode, googleEnabled }: { mode: "signup" | "login"; googleEnabled: boolean }) {
  const router = useRouter();
  const qs = useSearchParams();
  const [error, setError] = useState<string | null>(qs.get("error") ? `Sign-in failed (${qs.get("error")})` : null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong");
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <CardTitle className="text-2xl">{mode === "signup" ? "Create your seller account" : "Sign in"}</CardTitle>
        {mode === "signup" && (
          <Field id="displayName" label="Display name">
            {(a) => <Input {...a} name="displayName" required maxLength={80} />}
          </Field>
        )}
        <Field id="email" label="Email">
          {(a) => <Input {...a} name="email" type="email" required autoComplete="email" />}
        </Field>
        <Field id="password" label="Password" help={mode === "signup" ? "At least 10 characters. Common passwords, your email and simple patterns are not allowed." : undefined}>
          {(a) => (
            <Input
              {...a}
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 10 : 1}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          )}
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {mode === "login" && (
          <p className="text-sm"><Link className="font-medium text-primary" href="/forgot-password">Forgot your password?</Link></p>
        )}
        <Button type="submit" loading={busy}>{mode === "signup" ? "Sign up" : "Sign in"}</Button>
        {googleEnabled && (
          <a href="/api/auth/google" className={buttonClasses("secondary")}>Continue with Google</a>
        )}
        <p className="text-sm text-muted">
          {mode === "signup" ? (
            <>Already have an account? <Link className="font-medium text-primary" href="/login">Sign in</Link></>
          ) : (
            <>New here? <Link className="font-medium text-primary" href="/signup">Create an account</Link></>
          )}
        </p>
      </form>
    </Card>
  );
}
