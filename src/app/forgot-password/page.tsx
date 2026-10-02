import type { Metadata } from "next";
import { Suspense } from "react";
import ForgotPasswordForm from "../components/ForgotPasswordForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
