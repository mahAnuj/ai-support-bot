import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled: transformers.js
  // pulls in onnxruntime-node, whose native binaries cannot be bundled.
  serverExternalPackages: ["@huggingface/transformers"],
  // onnxruntime-node is loaded by a dynamic import that file tracing cannot
  // follow, so without this it is missing from the deployed functions. Only
  // the Linux x64 binaries are included; the package ships every platform.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
      "./node_modules/onnxruntime-common/**/*",
    ],
  },
};

export default nextConfig;
