import type { ReactNode } from "react";

/** Everything under /admin is private: never indexed (also X-Robots-Tag in next.config.ts + robots.txt) and never cached. */
export const metadata = { title: "Admin", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
