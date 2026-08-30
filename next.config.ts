import type { NextConfig } from "next";

const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
];

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Persist Turbopack's build cache (written under .next/cache) so warm
  // rebuilds are much faster. Paired with a BuildKit cache mount on
  // .next/cache in the Dockerfile so it survives across Coolify deploys.
  experimental: { turbopackFileSystemCacheForBuild: true },
  async headers() {
    return [
      {
        source: "/api/extension/:path*",
        headers: corsHeaders,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/prospecting", destination: "/routine/connections", permanent: false },
      { source: "/prospecting/:id", destination: "/routine/connections/:id", permanent: false },
      { source: "/job-changes", destination: "/routine/job-changes", permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.qrserver.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
