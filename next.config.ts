import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

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
