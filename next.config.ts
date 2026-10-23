import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // A second build directory lets a production build run beside `pnpm dev` (the e2e test and demo recorder use it).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  // Server-side browser (sandbox fix checks) and the sandbox's child processes stay out of the bundle.
  serverExternalPackages: ["playwright-core"],
  images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
