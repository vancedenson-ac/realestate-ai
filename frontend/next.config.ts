import type { NextConfig } from "next";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/**",
      },
    ],
  },
  // Proxy API requests so /listings/:id and /properties/:id pages can call backend
  // when using relative API URLs (no NEXT_PUBLIC_API_BASE). Prevents 404 on detail pages.
  async rewrites() {
    return [
      {
        source: "/realtrust-ai/:path*",
        destination: `${apiBase}/realtrust-ai/:path*`,
      },
    ];
  },
};

export default nextConfig;
