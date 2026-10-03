import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // studio-cue.com is the one address search engines should index. The App
  // Hosting address (*.hosted.app) serves the same pages; every page already
  // names studio-cue.com as canonical, and this keeps the duplicate out of the
  // index outright.
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "(?<host>.*\\.hosted\\.app)" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // Behind App Hosting's proxy the address the visitor used arrives as
      // x-forwarded-host, not Host.
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-host", value: "(?<fwd>.*\\.hosted\\.app)" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  async redirects() {
    return [
      // A static mock of the product with its old navigation and dead
      // buttons, retired 2026-10-02. The film shows the real thing.
      { source: "/studio-preview", destination: "/how-to/wedding-journey", permanent: true },
    ];
  },
};

export default nextConfig;
