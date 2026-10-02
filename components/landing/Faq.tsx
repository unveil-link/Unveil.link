import { Container, Section, SectionHeading } from "@/components/ui";

const faqs = [
  { q: "Do buyers need an account?", a: "No. Buyers pay with a card at checkout, with no sign-up or password. We ask for an email address at checkout, and access to the files is shared once the payment is confirmed. Delivery options are coming soon." },
  { q: "How do I get paid?", a: "Earnings from each sale show up in your dashboard after a short hold period. Payouts are handled through our payments partner once your balance reaches the minimum payout." },
  { q: "What does it cost?", a: "There are no subscriptions or monthly fees. Each sale carries a platform fee and card-processing fees, and you keep most of every sale. Your dashboard shows the exact breakdown." },
  { q: "What kinds of files can I sell?", a: "Photos and videos that you created and own the rights to. Sellers are verified and must follow our Terms." },
  { q: "Are my files private?", a: "Yes. Files are stored privately, and previews are blurred until a purchase. Payment links are private to the creator who shares them." },
];

export function Faq() {
  return (
    <Section id="faq" aria-labelledby="faq-title">
      <Container size="narrow">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" align="center" />
        <div className="mt-10 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          {faqs.map((f) => (
            <details key={f.q} className="group px-5 py-4 open:bg-surface-muted/50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-base font-semibold text-text [&::-webkit-details-marker]:hidden">
                {f.q}
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="mt-3 text-base text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}
