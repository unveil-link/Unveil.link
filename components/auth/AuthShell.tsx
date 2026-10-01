import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CardIcon, DownloadIcon, ShieldCheckIcon } from "@/components/landing/Icons";

const points = [
  { icon: CardIcon, title: "Get paid by card", body: "Buyers check out in seconds — no accounts, no friction." },
  { icon: ShieldCheckIcon, title: "Private by design", body: "Originals stay locked until a purchase is complete." },
  { icon: DownloadIcon, title: "Instant delivery", body: "Share one link anywhere. Files are delivered automatically." },
];

/** Two-column on desktop (brand panel + form), single column on mobile. */
export function AuthShell({ children, title, subtitle, footer }: { children: ReactNode; title: string; subtitle?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full bg-primary/50 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 size-[24rem] rounded-full bg-accent/30 blur-3xl" />
        <Link href="/" className="relative inline-flex items-center gap-2.5 self-start rounded-md" aria-label="Unveil home">
          <svg viewBox="0 0 100 100" className="size-8" aria-hidden="true">
            <rect width="100" height="100" rx="22" fill="var(--color-primary)" />
            <path d="M28 26v28a22 22 0 0 0 44 0V26" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
            <rect x="56" y="70" width="24" height="8" rx="4" fill="var(--color-accent)" transform="rotate(-18 68 74)" />
          </svg>
          <span className="text-xl font-bold tracking-tight">Unveil</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-extrabold tracking-tight text-balance">Sell your files with one simple link.</h2>
          <ul className="mt-8 space-y-6">
            {points.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-md bg-white/10 text-accent">
                  <p.icon className="size-6" />
                </span>
                <div>
                  <p className="font-semibold">{p.title}</p>
                  <p className="mt-0.5 text-sm text-white/70">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/55">© {new Date().getFullYear()} Unveil · unveil.link</p>
      </aside>

      <main id="main" className="flex flex-col bg-background">
        <header className="flex h-16 items-center px-5 sm:px-8 lg:hidden">
          <Logo />
        </header>
        <div className="flex flex-1 items-start justify-center px-5 pb-12 pt-4 sm:px-8 sm:pt-10 lg:items-center lg:pt-0">
          <div className="w-full max-w-md">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
            <div className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card sm:p-7">{children}</div>
            {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
