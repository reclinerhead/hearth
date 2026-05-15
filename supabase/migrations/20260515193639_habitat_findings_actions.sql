-- Recommended next-step actions for a habitat finding. Per-finding rather
-- than per-module because the right action depends on what the module
-- returned (Zone 1 radon vs Zone 3 radon push different CTAs). Nullable
-- so existing rows remain valid; modules backfill actions on their next
-- check() and the orchestrator upserts the value.
--
-- Shape (TypeScript: FindingAction[] from lib/habitat/types.ts):
--   [{ kind: 'product' | 'link' | 'service',
--      label: string,
--      url: string,
--      priceHint?: string }]
--
-- Kept separate from the existing `findings` jsonb so the LLM/chat layer
-- reads structured data and the dashboard reads UI actions without each
-- having to filter the other out.
alter table hearth.habitat_findings
  add column if not exists actions jsonb;
