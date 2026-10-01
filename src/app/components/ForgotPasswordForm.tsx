"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, CardTitle, Field, Input } from "@/components/ui";

export default function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError((await res.json().catch(() => ({}))).error ?? "Something went wrong");
  }

  return (
    <Card className="mx-auto max-w-md">
      {done ? (
        <div className="flex flex-col gap-3" data-testid="forgot-done">
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <p className="text-sm">If an account exists for that address, we&apos;ve sent a link to reset your password. It is valid for 1 hour.</p>
          <Link className="text-sm font-medium text-primary" href="/login">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <Field id="email" label="Email">
            {(a) => <Input {...a} name="email" type="email" required autoComplete="email" />}
          </Field>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" loading={busy}>Send reset link</Button>
          <Link className="text-sm font-medium text-primary" href="/login">Back to sign in</Link>
        </form>
      )}
    </Card>
  );
}
