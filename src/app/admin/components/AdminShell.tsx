import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Container } from "@/components/ui";
import AdminLogout from "./AdminLogout";

export default function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <>
      <header className="border-b border-border bg-background">
        <Container size="default" className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Logo />
            <span className="text-sm font-semibold">Admin</span>
            <nav className="flex gap-4 text-sm" aria-label="Admin">
              <Link href="/admin/sellers/flagged" className="underline">Flagged sellers &amp; review</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted"><span data-testid="admin-email">{email}</span><AdminLogout /></div>
        </Container>
      </header>
      <Container as="main" size="default" className="flex-1 py-8">{children}</Container>
    </>
  );
}
