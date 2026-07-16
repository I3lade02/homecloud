import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  transpilePackages: ["@picloud/contracts"],
};

export default nextConfig;
