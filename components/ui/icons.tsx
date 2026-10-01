import type { SVGProps } from "react";

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type P = SVGProps<SVGSVGElement>;
export const HomeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 11 12 4l8 7" /><path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" /></svg>
);
export const GridIcon = (p: P) => (
  <svg {...base} {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const LogOutIcon = (p: P) => (
  <svg {...base} {...p}><path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" /><path d="m15 8 4 4-4 4M19 12H9" /></svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base} {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>
);
export const ExternalIcon = (p: P) => (
  <svg {...base} {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
);
export const InfoIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const AlertIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 4 2.8 19.5a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5L12 4Z" /><path d="M12 10v4.5M12 17.5h.01" /></svg>
);
export const XIcon = (p: P) => (
  <svg {...base} {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>
);
export const FileIcon = (p: P) => (
  <svg {...base} {...p}><path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6 3.5Z" /><path d="M14 3.5V8h4" /></svg>
);
export const VideoIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="6" width="12" height="12" rx="2" /><path d="m15.5 10.5 5-2.5v8l-5-2.5" /></svg>
);
export const WalletIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2" /><path d="M4 7.5V17a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" /><circle cx="15.5" cy="13.5" r="1.1" /></svg>
);
export const ClockIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const ChartIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 19V5M4 19h16" /><path d="m8 15 3.5-4 3 2.5L19 8" /></svg>
);
export const CoinIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.4-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.7-2.4 1.8 0 2.5 5 1.2 5 3.7 0 1.1-1.1 1.8-2.6 1.8-1.2 0-2.2-.5-2.6-1.4M12 6.5V8m0 8v1.5" /></svg>
);
export const EyeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const EyeOffIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 3l18 18" /><path d="M10.6 6a9 9 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3.2 3.9M6.6 7.6A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);
export const SparkIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5Z" /></svg>
);

// Shared glyphs from the landing set, re-exported so app code has one icon import.
export { CheckIcon, ImageIcon, LockIcon, ShieldCheckIcon, UploadIcon, DownloadIcon, CardIcon, LinkIcon, UserOffIcon, ShareIcon, TagIcon } from "@/components/landing/Icons";
