import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "../components/ResetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
