import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A package-lock.json further up the tree (in the home directory) otherwise makes Turbopack take
  // that directory as the workspace root, and the dev server then watches and serves from the wrong
  // place — one suspected cause of stale CSS during development.
  turbopack: { root: path.resolve(process.cwd()) },
  output: "export",
  basePath: "/ttr",
  assetPrefix: "/ttr",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
