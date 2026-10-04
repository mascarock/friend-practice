import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.LOCAL_COMPUTER_BUILD === "1" ? ".next-desktop" : ".next",
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
};

export default nextConfig;
