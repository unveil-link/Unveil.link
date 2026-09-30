import Link from "next/link";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("size-8", className)} aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="var(--color-primary)" />
      <path d="M28 26v28a22 22 0 0 0 44 0V26" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
      <rect x="56" y="70" width="24" height="8" rx="4" fill="var(--color-accent)" transform="rotate(-18 68 74)" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-md", className)} aria-label="Unveil home">
      <LogoMark />
      <span className="text-xl font-bold tracking-tight text-text">Unveil</span>
    </Link>
  );
}
