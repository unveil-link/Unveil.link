import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { ButtonLink, Container } from "@/components/ui";

/** Placeholder for footer pages that haven't been written yet. Deliberately contains no policy / legal wording. */
export const comingSoonRobots: Metadata["robots"] = { index: false, follow: false };

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <header className="border-b border-border bg-background">
        <Container className="flex h-16 items-center"><Logo /></Container>
      </header>
      <main id="main" className="flex-1">
        <Container size="narrow" className="py-16 text-center sm:py-24">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-lg text-muted" data-testid="coming-soon">Coming soon.</p>
          <div className="mt-8"><ButtonLink href="/">Back to Unveil</ButtonLink></div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
