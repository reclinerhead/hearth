# Hearth

Hearth is a homeowner knowledge app. It ingests the paper trail of a house (receipts, permits, manuals, photos, video), turns it into a structured inventory with AI-extracted facts, and then goes looking for the things a homeowner does not know to ask about: flood zones, radon risk, nearby Superfund sites, drinking water quality, and the maintenance a house actually needs. The output is a dashboard that reads like a briefing rather than a filing cabinet.

## How it's built

- **Next.js App Router** with React Server Components and server actions. The whole app is TypeScript in strict mode on Tailwind CSS v4 with a token-driven design system.
- **Supabase Postgres behind row-level security.** Application data lives in a dedicated `hearth` schema, isolated from the standard `auth` and `public` schemas. Every table is RLS-scoped to its owner; background jobs use a service-role client that never runs under a user session.
- **Vercel AI SDK and AI Gateway** route model calls across Anthropic, OpenAI, and xAI. Document classification, receipt extraction, serial-number decoding, inventory research, and maintenance-plan synthesis are separate pipelines with model choice per feature.
- **Vercel Workflow** runs the durable jobs: multi-step ingestion, AI synthesis, and a scheduled storage sweep that reconciles private buckets against the rows that own them.
- **Mapbox** for address capture and geocoding, plus **EPA and FEMA public data** (Superfund SEMS, CWS service areas, SDWIS, radon zones, NFHL flood layers) behind a pluggable habitat-module framework with a shared cache layer.
- **Vitest** for selective coverage of the pure logic (ranking, parsing, geo math, orchestration rules). **GitHub Actions** runs the suite on every pull request.

## Where to look

- [docs/TechnicalGuide.md](docs/TechnicalGuide.md) is the hub: stack, repository layout, cross-cutting invariants, the design system, and an index of the architecture spokes.
- [docs/architecture/](docs/architecture/) holds the spokes, one per domain, each a standalone description of what is built and why.
- [lib/habitat/](lib/habitat/) is the public-data framework: the module contract, the orchestrator, and the EPA and FEMA modules.
- [lib/documents/](lib/documents/) is document ingestion: capture, classification, extraction, and the serial-number decode pipeline.
- [workflows/](workflows/) holds the durable jobs built on Vercel Workflow.
- [docs/architecture/storage-reconciliation.md](docs/architecture/storage-reconciliation.md) is the reliability story: how orphaned storage objects are detected and removed safely.

## Development

There is no local Supabase stack. Local `next dev`, Vercel previews, and production all connect to the same remote Supabase project, so schema changes are applied with `supabase db push` and take effect everywhere at once. `.env.example` lists the environment variables the app needs.

```bash
pnpm install
pnpm dev
```

`pnpm test` runs the Vitest suite. `pnpm lint` and `pnpm build` match what CI and Vercel run.

## License

All rights reserved. The source is published for review; see [LICENSE](LICENSE).
