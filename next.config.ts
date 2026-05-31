import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // The report-generation route (issue #207) renders PDFs with headless
  // Chromium via @sparticuz/chromium. Two settings are load-bearing:
  //
  //   1. serverExternalPackages keeps the package out of the bundle trace
  //      so Next doesn't try to inline its brotli payload.
  //   2. outputFileTracingIncludes force-includes the brotli Chromium
  //      binary into the function. Static tracing can't see it (it's
  //      resolved at runtime via a computed path), so without this the
  //      function deploys without the binary and fails at runtime with
  //      "Could not find Chromium". Verified via the spike branch for #207.
  serverExternalPackages: ["@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/reports/water-quality": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
  },

  // Existing habitat findings have `/about/classification#<anchor>` URLs
  // baked into their activity_log JSONB; we can't rewrite those rows.
  // The destination page now lives at /how-it-works, so resolve the old
  // URL forever. Browsers append the original anchor after the redirect,
  // so /about/classification#radon lands at /how-it-works#radon
  // without needing per-anchor rules.
  async redirects() {
    return [
      {
        source: "/about/classification",
        destination: "/how-it-works",
        permanent: true,
      },
    ];
  },
};

export default withWorkflow(nextConfig);
