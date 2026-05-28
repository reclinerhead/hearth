// CCR extraction prompt version (issue #176 — WQA-3). Bumped manually
// whenever lib/documents/ai/ccr-prompt.ts changes shape in a way that
// would invalidate previously-extracted rows: a new section, a removed
// section, a renamed field, a tightened/loosened nullability rule.
//
// Persisted alongside every hearth.water_system_reports row in the
// extraction_version column. WQA-9's reanalysis trigger compares this
// constant to the value stored on existing rows to decide whether a
// re-extraction is warranted. Until WQA-9 ships, the value is only
// recorded — never read for decisions.
//
// Convention: monotonically-increasing 'vN' strings, with the
// underlying rationale captured in the migration history (the version
// bump itself is usually a code change, and the prompt diff in git
// log explains what changed). Small wording tweaks that preserve the
// schema do NOT require a bump.

export const CCR_EXTRACTION_VERSION = "v2";
