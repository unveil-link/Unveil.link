import { Badge } from "@/components/ui";
import { VIDEO_UPLOAD } from "@/lib/features";
import { LockIcon, ImageIcon, ShieldCheckIcon } from "./Icons";

/** Pure-CSS visual mock of a buyer-facing payment link card with a blurred preview. */
export function PaymentLinkMock() {
  return (
    <div className="relative" role="img" aria-label="Illustration of a payment link card with a blurred preview, a price of $12, and a Pay button">
      <div aria-hidden="true" className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-accent/25 blur-2xl" />
      <div aria-hidden="true" className="overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
        {/* Blurred preview */}
        <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-[#7c6cf5] via-[#c38bf0] to-[#f7a8b8]">
          <div className="absolute -left-6 top-6 size-40 rounded-full bg-[#14b8a6]/70 blur-2xl" />
          <div className="absolute right-0 top-0 size-44 rounded-full bg-[#ffd28a]/70 blur-2xl" />
          <div className="absolute bottom-0 left-1/3 h-28 w-44 rounded-full bg-[#4f3be8]/70 blur-2xl" />
          <div className="absolute inset-0 backdrop-blur-xl bg-white/10" />
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-xs font-semibold text-text">
            <ImageIcon className="size-3.5" /> {VIDEO_UPLOAD ? "12 photos · 2 videos" : "12 photos"}
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid size-14 place-items-center rounded-full bg-white/90 text-primary shadow-card">
              <LockIcon className="size-6" />
            </div>
          </div>
        </div>
        {/* Details */}
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-text">Spring collection pack</p>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-muted">
                <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">M</span>
                by Maya Lin
                <ShieldCheckIcon className="size-4 text-success" />
              </div>
            </div>
            <p className="text-2xl font-bold text-text">$12</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">Verified creator</Badge>
            <Badge tone="neutral">Secure checkout</Badge>
          </div>
          <div className="flex h-12 items-center justify-center rounded-md bg-primary text-base font-semibold text-on-primary shadow-sm">
            Pay $12
          </div>
          <p className="text-center text-xs text-muted">Pay by card · No account needed</p>
        </div>
      </div>
    </div>
  );
}
