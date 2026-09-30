import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Container } from "@/components/ui";

export default function AppShell({ children, size = "narrow", right }: { children: ReactNode; size?: "narrow" | "default"; right?: ReactNode }) {
  return (
    <>
      <header className="border-b border-border bg-background">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          {right}
        </Container>
      </header>
      <Container as="main" size={size} className="flex-1 py-8">
        {children}
      </Container>
    </>
  );
}
