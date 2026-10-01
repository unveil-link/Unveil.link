import { Suspense } from "react";
import ForgotPasswordForm from "../components/ForgotPasswordForm";
import AppShell from "../components/AppShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AppShell>
  );
}
