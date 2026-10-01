import { Suspense } from "react";
import ResetPasswordForm from "../components/ResetPasswordForm";
import AppShell from "../components/AppShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AppShell>
  );
}
