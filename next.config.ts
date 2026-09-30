import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: `bun run build`/`start` (and the Dockerfile) copy
  // .next/static + public into .next/standalone for a self-contained server.
  output: "standalone",
  serverExternalPackages: ["sharp", "mammoth", "unpdf", "exifreader"],
};

export default nextConfig;
