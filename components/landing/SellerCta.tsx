import { ButtonLink, Container, Section, SectionHeading } from "@/components/ui";
import { CheckIcon } from "./Icons";

const perks = ["Keep most of every sale", "No subscriptions or monthly fees", "Sales, fees and balance in your dashboard", "Payout requests coming soon"];

export function SellerCta() {
  return (
    <Section id="sellers" tone="ink" aria-labelledby="sellers-title">
      <Container className="grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <SectionHeading
            id="sellers-title"
            invert
            eyebrow="For creators"
            title="Turn your work into income, on your terms"
            description="Pay only when you make a sale. Set your own prices and keep most of every sale — no subscriptions, no lock-in."
          />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg" className="bg-white !text-ink hover:bg-white/90">
              Create your account
            </ButtonLink>
            <ButtonLink href="#faq" size="lg" variant="ghost" className="border border-white/30 text-white hover:bg-white/10">
              Read the FAQ
            </ButtonLink>
          </div>
        </div>
        <ul className="grid gap-3 rounded-xl border border-white/15 bg-white/5 p-6">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-3 text-base text-white">
              <CheckIcon className="mt-0.5 size-5 shrink-0 text-accent" /> {p}
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
