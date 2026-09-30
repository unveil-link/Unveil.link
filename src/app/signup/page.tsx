import { Suspense } from "react";
import AuthForm from "../components/AuthForm";
import AppShell from "../components/AppShell";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <AuthForm mode="signup" googleEnabled={!!config.google} />
      </Suspense>
    </AppShell>
  );
}
