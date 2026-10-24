import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled: transformers.js
  // pulls in onnxruntime-node, whose native binaries cannot be bundled.
  serverExternalPackages: ["@huggingface/transformers"],
  // onnxruntime-node is loaded by a dynamic import that file tracing cannot
  // follow, so without this it is missing from the deployed functions. Only
  // the two Linux x64 CPU files are included: on Linux the package also
  // downloads GPU (CUDA) libraries of ~260 MB, past Vercel's 250 MB limit.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
      "./node_modules/onnxruntime-common/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/api/**/*": [
      "./node_modules/onnxruntime-node/bin/**/*providers*",
      "./node_modules/onnxruntime-web/**/*",
    ],
  },
};

export default nextConfig;
