"use client";
import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button, GridIcon, HomeIcon, LogOutIcon, PlusIcon, ToastProvider } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: HomeIcon, exact: true },
  { href: "/dashboard/drops", label: "Drops", icon: GridIcon, exact: false },
  { href: "/dashboard/drops/new", label: "New drop", icon: PlusIcon, exact: true },
] as const;

function isActive(path: string, item: { href: string; exact: boolean }) {
  if (item.href === "/dashboard/drops") return path.startsWith("/dashboard/drops") && path !== "/dashboard/drops/new";
  return item.exact ? path === item.href : path.startsWith(item.href);
}

export default function DashboardShell({ seller, children }: { seller: { displayName: string; email: string }; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initial = (seller.displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <ToastProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
        <a href="#dash-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary">Skip to content</a>

        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface px-4 py-5 lg:flex">
          <Logo className="px-2" href="/dashboard" />
          <nav aria-label="Dashboard" className="mt-8 flex flex-col gap-1">
            {NAV.map((n) => {
              const active = isActive(path, n);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors",
                    active ? "bg-primary-soft text-primary-hover" : "text-muted hover:bg-surface-muted hover:text-text",
                  )}
                >
                  <n.icon className="size-5" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-border pt-4">
            <div className="flex items-center gap-3 px-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-white" aria-hidden="true">{initial}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{seller.displayName}</p>
                <p className="truncate text-xs text-muted">{seller.email}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={signOut} loading={signingOut}>
              <LogOutIcon className="size-4" /> Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
            <Logo href="/dashboard" />
            <Button variant="ghost" size="sm" onClick={signOut} loading={signingOut} aria-label="Sign out">
              <LogOutIcon className="size-4" /> Sign out
            </Button>
          </header>

          <main id="dash-main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
            {children}
          </main>

          {/* Mobile bottom nav */}
          <nav aria-label="Dashboard" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <ul className="mx-auto grid max-w-md grid-cols-3">
              {NAV.map((n) => {
                const active = isActive(path, n);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active ? "text-primary" : "text-muted")}
                    >
                      <n.icon className="size-6" />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
    </ToastProvider>
  );
}
