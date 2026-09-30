import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "pg", "bcryptjs"],
  poweredByHeader: false,
  // Lets the e2e suite build into its own dir without clobbering a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    // Landing page links to /signin; the route is /login.
    return [{ source: "/signin", destination: "/login", permanent: false }];
  },
};
export default nextConfig;
