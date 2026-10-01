"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card, CardTitle, Field, Input } from "@/components/ui";

export default function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pw = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: pw }),
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError((await res.json().catch(() => ({}))).error ?? "Something went wrong");
  }

  return (
    <Card className="mx-auto max-w-md">
      {done ? (
        <div className="flex flex-col gap-3" data-testid="reset-done">
          <CardTitle className="text-2xl">Password updated</CardTitle>
          <p className="text-sm">You&apos;ve been signed out everywhere. Sign in with your new password.</p>
          <Link className="text-sm font-medium text-primary" href="/login">Sign in</Link>
        </div>
      ) : !token ? (
        <div className="flex flex-col gap-3">
          <CardTitle className="text-2xl">Invalid link</CardTitle>
          <p className="text-sm">This reset link is missing its token. <Link className="font-medium text-primary" href="/forgot-password">Request a new one</Link>.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <Field id="password" label="New password" help="At least 10 characters. Common passwords and simple patterns are not allowed.">
            {(a) => <Input {...a} name="password" type="password" required minLength={10} autoComplete="new-password" />}
          </Field>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" loading={busy}>Update password</Button>
        </form>
      )}
    </Card>
  );
}
