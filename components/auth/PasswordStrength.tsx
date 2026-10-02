import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/landing/Icons";
import { passwordRules, passwordStrength } from "@/lib/password-hint";

const bar = { danger: "bg-danger", warning: "bg-[#d98a1c]", success: "bg-success", muted: "bg-border" } as const;
const text = { danger: "text-danger", warning: "text-warning", success: "text-success", muted: "text-muted" } as const;

/** Strength meter + live checklist of the backend rules. Announced politely via aria-live on the label only. */
export function PasswordStrength({ id, password, email, displayName, rejected }: { id: string; password: string; email?: string; displayName?: string; rejected?: boolean }) {
  // `rejected`: the server refused exactly this password (e.g. on the common-password blocklist) -> override the local estimate.
  const s = rejected ? { score: 1 as const, label: "Too common", tone: "danger" as const } : passwordStrength(password, { email, displayName });
  const rules = passwordRules(password, { email, displayName });
  return (
    <div id={id} className="space-y-2.5 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", password && i <= s.score ? bar[s.tone] : "bg-border")} />
          ))}
        </div>
        <span aria-live="polite" className={cn("min-w-16 text-right text-xs font-semibold", text[s.tone])}>
          {password ? `Strength: ${s.label}` : ""}
        </span>
      </div>
      <ul className="space-y-1">
        {rules.map((r) => (
          <li key={r.id} className={cn("flex items-start gap-2", r.ok ? "text-success" : "text-muted")}>
            <span aria-hidden="true" className={cn("mt-1 grid size-4 shrink-0 place-items-center rounded-full border", r.ok ? "border-success bg-success text-white" : "border-border-strong")}>
              {r.ok && <CheckIcon className="size-3" strokeWidth={3} />}
            </span>
            <span>
              {r.label}
              <span className="sr-only">{r.ok ? " — met" : " — not met yet"}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Very common passwords are also rejected when you submit.</p>
    </div>
  );
}
