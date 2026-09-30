import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "pg", "bcryptjs"],
  poweredByHeader: false,
};
export default nextConfig;
