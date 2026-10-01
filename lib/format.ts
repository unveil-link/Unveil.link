export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")} GB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** 83 -> "1:23" */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function fileSummaryLabel(files: { mime: string }[]): string {
  const img = files.filter((f) => f.mime.startsWith("image/")).length;
  const vid = files.filter((f) => f.mime.startsWith("video/")).length;
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [img && p(img, "image"), vid && p(vid, "video")].filter(Boolean);
  return `${p(files.length, "file")}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * Human-readable wait: seconds up to 2 minutes ("45s", "90s"), then minutes ("5 min"), then hours ("1 h 12 min", "2 h").
 * Rounds UP (a wait is never understated) and never shows "0".
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s <= 120) return `${s}s`;
  const mins = Math.ceil(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Spoken/long form for assistive tech: "58 minutes", "1 hour 12 minutes", "45 seconds". */
export function formatDurationLong(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (s <= 120) return u(s, "second");
  const mins = Math.ceil(s / 60);
  if (mins < 60) return u(mins, "minute");
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${u(h, "hour")} ${u(m, "minute")}` : u(h, "hour");
}
