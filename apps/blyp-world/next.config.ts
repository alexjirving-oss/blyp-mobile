import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  transpilePackages: ["amazon-ivs-web-broadcast"],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      crypto: false,
      stream: false,
    };
    return config;
  },
};

export default nextConfig;
