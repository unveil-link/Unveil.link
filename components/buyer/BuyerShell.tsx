import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Container } from "@/components/ui";

/** Minimal chrome for buyer-facing pages: logo header, soft brand glow, small footer. */
export function BuyerShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 h-[30rem] bg-[radial-gradient(50rem_24rem_at_80%_0%,rgb(79_59_232/0.13),transparent_70%),radial-gradient(36rem_20rem_at_5%_8%,rgb(20_184_166/0.12),transparent_70%)]"
      />
      <header className="relative">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <span className="text-xs font-medium text-muted">Secure payment link</span>
        </Container>
      </header>
      <main id="main" className="relative flex-1 pb-10 pt-2 sm:pt-6">{children}</main>
      <footer className="relative border-t border-border bg-surface/70">
        <Container size="narrow" className="flex flex-col items-center gap-1 py-6 text-center text-xs text-muted sm:flex-row sm:justify-between sm:text-left">
          <p>© {new Date().getFullYear()} Unveil · unveil.link</p>
          <p>Payments by a trusted provider. We never store card numbers.</p>
        </Container>
      </footer>
    </div>
  );
}
