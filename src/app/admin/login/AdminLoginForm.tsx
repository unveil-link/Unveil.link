"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardTitle, Field, Input } from "@/components/ui";

export default function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (res.ok) { router.replace("/admin/sellers/flagged"); router.refresh(); return; }
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setError(res.status === 401 ? "Invalid email or password" : (d.error ?? "Sign-in failed"));
  }
  return (
    <Card>
      <CardTitle>Admin sign in</CardTitle>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3" data-testid="admin-login-form">
        <Field id="admin-email" label="Email">{(a) => <Input {...a} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field id="admin-password" label="Password">{(a) => <Input {...a} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="self-start" data-testid="admin-login-submit">Sign in</Button>
      </form>
    </Card>
  );
}
