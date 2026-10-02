import { CardIcon, DownloadIcon, UserOffIcon } from "@/components/ui";

const points = [
  { icon: CardIcon, title: "Secure checkout", body: "You pay by card on a separate checkout page." },
  { icon: DownloadIcon, title: "Access after payment", body: "Access to the files is shared once your payment is confirmed. Delivery options are coming soon." },
  { icon: UserOffIcon, title: "No account needed", body: "Just pay — nothing to sign up for." },
];

export function TrustPoints() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3" aria-label="Why buyers trust Unveil">
      {points.map((p) => (
        <li key={p.title} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 sm:flex-col sm:gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-[#0b5e55]"><p.icon className="size-5" /></span>
          <div>
            <p className="text-sm font-semibold text-text">{p.title}</p>
            <p className="mt-0.5 text-xs text-muted">{p.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
