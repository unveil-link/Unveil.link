import Link from "next/link";
import { cn } from "@/lib/cn";

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/dmca", label: "DMCA" },
  { href: "/contact", label: "Contact" },
] as const;

/** Small inline nav with the four legal/contact pages (placeholders until Legal supplies the copy). */
export function LegalLinks({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  return (
    <nav aria-label="Legal" className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGAL_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={cn("rounded-sm text-xs font-medium text-muted underline-offset-2 hover:text-text hover:underline", linkClassName)}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
