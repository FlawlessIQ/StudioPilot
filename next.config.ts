import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // A static mock of the product with its old navigation and dead
      // buttons, retired 2026-10-02. The film shows the real thing.
      { source: "/studio-preview", destination: "/how-to/wedding-journey", permanent: true },
    ];
  },
};

export default nextConfig;
