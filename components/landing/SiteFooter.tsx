import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Container } from "@/components/ui";

const links = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/dmca", label: "DMCA" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-2 max-w-xs text-sm text-muted">Sell your files with a simple payment link.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-sm font-medium text-muted hover:text-text">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
      <Container className="border-t border-border py-5">
        <p className="text-sm text-muted">© {new Date().getFullYear()} Unveil · unveil.link. All rights reserved.</p>
      </Container>
    </footer>
  );
}
