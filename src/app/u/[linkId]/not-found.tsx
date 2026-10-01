import { BuyerShell } from "@/components/buyer/BuyerShell";
import { ButtonLink, Container, LinkIcon } from "@/components/ui";

export const metadata = { title: "Link unavailable", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <BuyerShell>
      <Container size="narrow" className="py-10 sm:py-16">
        <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card" data-testid="link-unavailable">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-soft text-primary"><LinkIcon className="size-7" /></span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">This link isn’t available</h1>
          <p className="mt-2 text-muted">
            It may have been unpublished, removed, or mistyped. If someone sent you this link, ask them to double-check it.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <ButtonLink href="/">Go to Unveil</ButtonLink>
          </div>
        </div>
      </Container>
    </BuyerShell>
  );
}
