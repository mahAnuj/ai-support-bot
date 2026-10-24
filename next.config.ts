import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled: transformers.js
  // pulls in onnxruntime-node, whose native binaries cannot be bundled.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
