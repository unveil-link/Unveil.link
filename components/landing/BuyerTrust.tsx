import { Container, Section, SectionHeading } from "@/components/ui";
import { CardIcon, DownloadIcon, LinkIcon, ShieldCheckIcon, UserOffIcon } from "./Icons";

const points = [
  { icon: CardIcon, title: "Secure card checkout", body: "Payments are processed by a trusted payment provider. We never see or store your card number." },
  { icon: UserOffIcon, title: "No account needed", body: "Pay with a card and go. No sign-up, no passwords, no app to install." },
  { icon: DownloadIcon, title: "Access after payment", body: "Once your payment is confirmed, the creator’s files are shared with you. Delivery options are coming soon." },
  { icon: LinkIcon, title: "Private links", body: "Each payment link is private to the creator who shares it, and files are stored privately with blurred previews until purchase." },
  { icon: ShieldCheckIcon, title: "Verified creators", body: "Sellers are identity- and age-verified before they can publish a link." },
];

export function BuyerTrust() {
  return (
    <Section id="buyers" tone="surface" aria-labelledby="buyers-title">
      <Container>
        <SectionHeading
          id="buyers-title"
          eyebrow="For buyers"
          title="Checkout you can trust"
          description="Buying from a creator should be quick and safe. Here is what you can expect every time."
        />
        <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft text-[#0b5e55]">
                <p.icon className="size-6" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-text">{p.title}</h3>
                <p className="mt-1 text-sm text-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
