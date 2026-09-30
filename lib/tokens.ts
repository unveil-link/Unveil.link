/** Mirror of the CSS variables in app/globals.css — used by the /design style guide. */
export const colorTokens = [
  { name: "primary", value: "#4f3be8", note: "Brand, CTAs" },
  { name: "primary-hover", value: "#4030c9", note: "Hover / pressed" },
  { name: "primary-soft", value: "#eeebff", note: "Tinted backgrounds" },
  { name: "accent", value: "#14b8a6", note: "Highlights (decorative)" },
  { name: "accent-soft", value: "#d9f7f3", note: "Accent tint" },
  { name: "ink", value: "#14121f", note: "Dark sections" },
  { name: "background", value: "#f8f7fc", note: "Page" },
  { name: "surface", value: "#ffffff", note: "Cards, inputs" },
  { name: "surface-muted", value: "#f1effa", note: "Subtle fills" },
  { name: "text", value: "#14121f", note: "Body (16.9:1 on bg)" },
  { name: "muted", value: "#5e5b70", note: "Secondary text (6.2:1)" },
  { name: "border", value: "#e4e1ef", note: "Hairlines" },
  { name: "border-strong", value: "#c9c5dc", note: "Inputs, secondary buttons" },
  { name: "success", value: "#147a4b", note: "Success text" },
  { name: "success-soft", value: "#dcf5e8", note: "Success bg" },
  { name: "danger", value: "#c62828", note: "Errors, destructive" },
  { name: "danger-soft", value: "#fdeaea", note: "Danger bg" },
  { name: "warning", value: "#a84a07", note: "Warning text" },
  { name: "warning-soft", value: "#fdf0dc", note: "Warning bg" },
] as const;

export const radiusTokens = [
  { name: "sm", value: "0.5rem (8px)", cls: "rounded-sm" },
  { name: "md", value: "0.75rem (12px)", cls: "rounded-md" },
  { name: "lg", value: "1rem (16px)", cls: "rounded-lg" },
  { name: "xl", value: "1.5rem (24px)", cls: "rounded-xl" },
  { name: "full", value: "9999px", cls: "rounded-full" },
] as const;

export const shadowTokens = [
  { name: "sm", cls: "shadow-sm" },
  { name: "card", cls: "shadow-card" },
  { name: "pop", cls: "shadow-pop" },
] as const;

export const typeScale = [
  { name: "text-xs", size: "12 / 16", cls: "text-xs" },
  { name: "text-sm", size: "14 / 22", cls: "text-sm" },
  { name: "text-base", size: "16 / 26", cls: "text-base" },
  { name: "text-lg", size: "18 / 28", cls: "text-lg" },
  { name: "text-xl", size: "20 / 28", cls: "text-xl" },
  { name: "text-2xl", size: "24 / 32", cls: "text-2xl" },
  { name: "text-3xl", size: "30 / 36", cls: "text-3xl" },
  { name: "text-4xl", size: "36 / 40", cls: "text-4xl" },
  { name: "text-5xl", size: "48 / 1.05", cls: "text-5xl" },
  { name: "text-6xl", size: "60 / 1.02", cls: "text-6xl" },
] as const;

export const spacingScale = [1, 2, 3, 4, 6, 8, 12, 16] as const; // × 0.25rem (Tailwind default)
