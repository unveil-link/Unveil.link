import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "../components/AuthForm";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="signup" googleEnabled={!!config.google} />
    </Suspense>
  );
}
