import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardDescription,
  CardTitle,
  Container,
  Field,
  Input,
  Section,
  SectionHeading,
  Textarea,
} from "@/components/ui";
import { colorTokens, radiusTokens, shadowTokens, spacingScale, typeScale } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-8">
      <h2 id={id} className="mb-5 text-2xl font-bold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  return (
    <main className="flex-1 pb-20">
      <div className="border-b border-border bg-surface">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <Badge tone="warning">Dev style guide</Badge>
        </Container>
      </div>
      <Container className="pt-10">
        <SectionHeading
          eyebrow="Design system"
          title="Unveil tokens & components"
          description="Reference for every token and UI primitive. Source: app/globals.css and components/ui."
        />

        <Block id="colors" title="Colors">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {colorTokens.map((c) => (
              <li key={c.name} className="overflow-hidden rounded-md border border-border bg-surface">
                <div className="h-14 border-b border-border" style={{ background: c.value }} aria-hidden="true" />
                <div className="p-2.5">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="font-mono text-xs text-muted">{c.value}</p>
                  <p className="text-xs text-muted">{c.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="type" title="Typography (Inter)">
          <Card className="divide-y divide-border !p-0">
            {typeScale.map((t) => (
              <div key={t.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="w-40 shrink-0 font-mono text-xs text-muted">
                  {t.name} · {t.size}
                </span>
                <span className={`${t.cls} truncate font-semibold tracking-tight`}>Sell files with a link</span>
              </div>
            ))}
          </Card>
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <span className="font-normal">Regular 400</span>
            <span className="font-medium">Medium 500</span>
            <span className="font-semibold">Semibold 600</span>
            <span className="font-bold">Bold 700</span>
            <span className="font-extrabold">Extrabold 800</span>
          </div>
        </Block>

        <Block id="radius" title="Radius">
          <ul className="flex flex-wrap gap-4">
            {radiusTokens.map((r) => (
              <li key={r.name} className="text-center">
                <div className={`size-20 border border-border-strong bg-primary-soft ${r.cls}`} aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-muted">{r.value}</p>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="shadows" title="Shadows">
          <ul className="flex flex-wrap gap-6">
            {shadowTokens.map((s) => (
              <li key={s.name} className="text-center">
                <div className={`size-24 rounded-lg bg-surface ${s.cls}`} aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold">{s.name}</p>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="spacing" title="Spacing (4px base)">
          <ul className="space-y-2">
            {spacingScale.map((n) => (
              <li key={n} className="flex items-center gap-3">
                <span className="w-20 font-mono text-xs text-muted">
                  {n} · {n * 4}px
                </span>
                <span className="h-3 rounded-sm bg-primary" style={{ width: `${n * 4}px` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Block>

        <Block id="buttons" title="Buttons">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading>Saving…</Button>
              <Button variant="secondary" loading>
                Loading
              </Button>
              <Button disabled>Disabled</Button>
              <ButtonLink href="/" variant="secondary">
                Link button
              </ButtonLink>
            </div>
          </div>
        </Block>

        <Block id="badges" title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Primary</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="success">Paid</Badge>
            <Badge tone="warning">Pending</Badge>
            <Badge tone="danger">Refunded</Badge>
          </div>
        </Block>

        <Block id="forms" title="Inputs & fields">
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="space-y-5">
              <Field id="d-title" label="Title" help="Shown to buyers on your payment link.">
                {(a) => <Input placeholder="Spring collection pack" {...a} />}
              </Field>
              <Field id="d-price" label="Price (USD)" error="Enter a price of at least $1.">
                {(a) => <Input inputMode="decimal" defaultValue="0" {...a} />}
              </Field>
              <Field id="d-off" label="Disabled">
                {(a) => <Input disabled defaultValue="Can't edit this" {...a} />}
              </Field>
            </Card>
            <Card className="space-y-5">
              <Field id="d-desc" label="Description" optional help="Up to 500 characters.">
                {(a) => <Textarea placeholder="Tell buyers what is included…" {...a} />}
              </Field>
              <Field id="d-desc-err" label="Notes" error="This field is required.">
                {(a) => <Textarea rows={2} {...a} />}
              </Field>
            </Card>
          </div>
        </Block>

        <Block id="cards" title="Cards">
          <div className="grid gap-5 md:grid-cols-3">
            <Card>
              <CardTitle>Default card</CardTitle>
              <CardDescription>Border, surface background, card shadow.</CardDescription>
            </Card>
            <Card elevated={false}>
              <CardTitle>Flat card</CardTitle>
              <CardDescription>No shadow — for dense lists.</CardDescription>
            </Card>
            <Card className="border-primary/30 bg-primary-soft">
              <CardTitle>Tinted card</CardTitle>
              <CardDescription>Use className to tint.</CardDescription>
            </Card>
          </div>
        </Block>

        <Block id="layout" title="Container & Section">
          <div className="overflow-hidden rounded-lg border border-border">
            <Section className="!py-8">
              <Container size="narrow" className="rounded-md border border-dashed border-primary/50 bg-primary-soft py-4 text-sm">
                Section (default) › Container size=&quot;narrow&quot; (max-w-2xl)
              </Container>
            </Section>
            <Section tone="surface" className="!py-8">
              <Container className="rounded-md border border-dashed border-primary/50 bg-primary-soft py-4 text-sm">
                Section tone=&quot;surface&quot; › Container default (max-w-6xl)
              </Container>
            </Section>
            <Section tone="ink" className="!py-8">
              <Container className="rounded-md border border-dashed border-white/40 py-4 text-sm">
                Section tone=&quot;ink&quot;
              </Container>
            </Section>
          </div>
        </Block>
      </Container>
    </main>
  );
}
