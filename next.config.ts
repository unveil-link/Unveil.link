import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy (static, applies to every response).
 *  - default-src 'self'            everything (scripts, XHR, images, fonts) from our own origin only.
 *  - script-src 'self' 'unsafe-inline'
 *        Next.js App Router emits inline bootstrap/RSC-payload <script> tags; a nonce-based policy would need a
 *        per-request proxy and would force every page (incl. the static landing page) to render dynamically.
 *        We accept 'unsafe-inline' for scripts for now; mitigations: no third-party script origins, object-src 'none',
 *        base-uri 'self', React escapes output, and user content is only ever served as images/attachments.
 *        'unsafe-eval' is added in `next dev` only (React debugging needs it).
 *  - style-src 'self' 'unsafe-inline'   Tailwind/Next inject inline styles.
 *  - img-src 'self' data: blob:    blurred previews are same-origin /api/files/:id/preview; data:/blob: for UI/upload previews.
 *  - font-src 'self' data:         next/font self-hosts Inter at build time.
 *  - connect-src 'self'            fetch() only to our own API.
 *  - frame-ancestors 'none'        no one may embed us (clickjacking), same as X-Frame-Options: DENY.
 *  - object-src 'none', base-uri 'self', form-action 'self'.
 * When payments land (hosted card fields / processor redirect) add that processor's origin to script-src/frame-src/connect-src.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Browsers ignore HSTS on plain http, so it is safe to send everywhere; TLS itself is terminated by the host/CDN.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "pg", "bcryptjs"],
  poweredByHeader: false, // removes X-Powered-By
  // Lets the e2e suite build into its own dir without clobbering a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      // Landing page links to /signin; the route is /login.
      { source: "/signin", destination: "/login", permanent: false },
      // Legacy public link path -> /u/ (308).
      { source: "/d/:linkId", destination: "/u/:linkId", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Link pages and anything that renders a drop publicly: never index.
      { source: "/u/:path*", headers: noindex },
      { source: "/d/:path*", headers: noindex },
      { source: "/api/public/:path*", headers: noindex },
      { source: "/api/files/:path*", headers: noindex },
      { source: "/admin/:path*", headers: [...noindex, { key: "Cache-Control", value: "no-store" }] },
      { source: "/admin", headers: [...noindex, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/admin/:path*", headers: [...noindex, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/internal/:path*", headers: noindex },
    ];
  },
};
export default nextConfig;
