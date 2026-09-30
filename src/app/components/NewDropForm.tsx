"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "@/components/ui";

export default function NewDropForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/drops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: f.get("title"),
        description: f.get("description"),
        priceCents: Math.round(Number(f.get("price")) * 100),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/dashboard/drops/${data.drop.id}`);
    else setError(data.error ?? "Failed to create drop");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field id="title" label="Title">{(a) => <Input {...a} name="title" required maxLength={120} />}</Field>
      <Field id="description" label="Description" optional>{(a) => <Textarea {...a} name="description" rows={2} maxLength={2000} />}</Field>
      <Field id="price" label="Price (USD)" help="Between $1 and $500.">
        {(a) => <Input {...a} name="price" type="number" step="0.01" min="1" max="500" required />}
      </Field>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={busy} className="self-start">Create draft</Button>
    </form>
  );
}
