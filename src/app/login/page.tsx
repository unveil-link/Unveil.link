import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "../components/AuthForm";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="login" googleEnabled={!!config.google} />
    </Suspense>
  );
}
