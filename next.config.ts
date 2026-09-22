import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ttr",
  assetPrefix: "/ttr",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
