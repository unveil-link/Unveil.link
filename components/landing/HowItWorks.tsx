import { Card, CardDescription, CardTitle, Container, Section, SectionHeading } from "@/components/ui";
import { SELLABLE } from "@/lib/features";
import { ShareIcon, TagIcon, UploadIcon } from "./Icons";

const steps = [
  { icon: UploadIcon, title: "Upload your files", body: `Drag in ${SELLABLE} from your phone or computer. We store them privately and generate a blurred preview.` },
  { icon: TagIcon, title: "Set a price & get a link", body: "Choose what each link costs and get a shareable payment link in seconds." },
  { icon: ShareIcon, title: "Share anywhere and get paid", body: "Post your link in a message, bio, or email. Buyers pay by card, with no account needed. Access to the files is shared once payment is confirmed." },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" aria-labelledby="how-title">
      <Container>
        <SectionHeading id="how-title" eyebrow="How it works" title="From upload to paid in three steps" align="center" />
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-md bg-primary-soft text-primary">
                    <s.icon className="size-6" />
                  </span>
                  <span className="text-sm font-semibold text-muted">Step {i + 1}</span>
                </div>
                <CardTitle className="mt-4 text-xl">{s.title}</CardTitle>
                <CardDescription className="text-base">{s.body}</CardDescription>
              </Card>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
