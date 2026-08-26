import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Framer (and any parent site) to embed this app in an iframe.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
