"use client";
import { Alert, Button } from "@/components/ui";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Alert tone="danger" title="We couldn’t load this page" action={<Button size="sm" variant="secondary" onClick={reset}>Try again</Button>}>
        Something went wrong on our side. Your work is safe — try again in a moment.
      </Alert>
    </div>
  );
}
