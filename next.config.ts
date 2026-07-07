import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mupdf carga un binario WASM (mupdf-wasm.wasm) en runtime. Si Next lo bundlea, la
  // resolución del .wasm se rompe en la función serverless. Externalizarlo hace que se
  // requiera desde node_modules (incluido vía output file tracing) sin pasar por el bundler.
  serverExternalPackages: ['mupdf'],
};

export default nextConfig;
