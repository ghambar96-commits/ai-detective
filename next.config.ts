import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "mammoth", "unpdf", "exifreader"],
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
