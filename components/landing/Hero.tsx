import { Badge, ButtonLink, Container } from "@/components/ui";
import { CheckIcon } from "./Icons";
import { PaymentLinkMock } from "./PaymentLinkMock";
import { SELLABLE } from "@/lib/features";

export function Hero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 h-[34rem] bg-[radial-gradient(60rem_28rem_at_75%_0%,rgb(79_59_232/0.14),transparent_70%),radial-gradient(40rem_24rem_at_10%_10%,rgb(20_184_166/0.12),transparent_70%)]"
      />
      <Container className="relative grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:py-24">
        <div>
          <Badge tone="primary" className="mb-5">
            <ShieldDot /> Verification required to publish
          </Badge>
          <h1 id="hero-title" className="text-5xl font-extrabold tracking-tight text-balance sm:text-6xl">
            Sell your files with <span className="text-primary">one simple link</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted sm:text-xl">
            Upload your {SELLABLE}, set a price, and share a payment link anywhere. Buyers pay by card — no
            account needed — and access to the files is shared once payment is confirmed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg">
              Create your account
            </ButtonLink>
            <ButtonLink href="#how-it-works" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>
          <ul className="mt-8 flex flex-col gap-2 text-sm text-muted sm:flex-row sm:flex-wrap sm:gap-x-6">
            {["No subscriptions", "Keep most of every sale", "Paid by card"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckIcon className="size-4 text-success" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto w-full max-w-sm lg:max-w-md">
          <PaymentLinkMock />
        </div>
      </Container>
    </section>
  );
}

function ShieldDot() {
  return <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />;
}
