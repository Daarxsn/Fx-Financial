import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFKit resolves standard-font AFM resources relative to its installed package at runtime.
  // Keep it external to Next/Turbopack so packaged paths are not rewritten to /ROOT/node_modules.
  serverExternalPackages: ["pdfkit"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
