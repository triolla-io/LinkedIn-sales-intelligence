import type { NextConfig } from "next";

const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
];

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: "/api/extension/:path*",
        headers: corsHeaders,
      },
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
