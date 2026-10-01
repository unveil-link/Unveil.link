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
