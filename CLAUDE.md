@AGENTS.md

# CLAUDE.md

## Development Workflow

Hearth development follows a four-stage loop built around GitHub issues as the single source of truth, with a clean separation between architectural thinking and implementation. Claude (in the project chat) handles architecture, design discussions, bug triage, and Claude Code prompt authoring. Claude Code (the VS Code extension) handles implementation, file edits, test authoring, and Git operations via the gh CLI. GitHub issues are the durable artifact that connect the two — every non-trivial change starts as an issue and ends with that issue being closed by a merged PR.

**Stage 1 — Brainstorm and capture.** New features, refactors, and bug fixes begin as a conversation in the project chat. Once the approach is clear enough to act on, the outcome is captured as a GitHub issue using the project's `feature.yml` or `bug.yml` templates. The "Do-not-change list," "Prior art / related context," and "Affected files" fields are treated as load-bearing — they become the contract Claude Code works against. If the change introduces or modifies pure logic that warrants test coverage (see "When to write unit tests" below), the issue should call this out explicitly so Claude Code knows to author tests as part of the implementation. Issues can be edited iteratively as thinking evolves; they don't need to be perfect on first draft.

**Stage 2 — Prompt and implement.** Before writing a Claude Code prompt, Todd syncs project knowledge to the latest main branch (GitHub sync in the Claude project settings) so that any architectural guidance references the current state of the code; this is Todd's pre-prompt checklist item, not something Claude Code can verify. Any in-chat edits to an issue must also be pushed to GitHub before prompting — the issue on GitHub is always the source of truth, not the version in chat. Claude Code prompts reference the issue number (`Implement #42, follow acceptance criteria, respect do-not-change list`) rather than repeating the full specification; Claude Code pulls the issue content via `gh issue view`. At the start of a Claude Code session, run `gh auth status` once to confirm `gh` is authenticated — if it isn't, `gh issue view` and `gh pr create` will fail silently or interactively prompt, breaking the flow. Before writing any code, Claude Code reads [docs/TechnicalGuide.md](docs/TechnicalGuide.md) to align with current architecture, integrations, and conventions — this is a standing precondition for every task, whether the prompt mentions it or not (see "Technical guide as living documentation" below). The prompt instructs Claude Code to work on a feature branch (`feature/N-short-description` or `fix/N-short-description`), never directly on main. When the issue includes test coverage requirements, the prompt explicitly directs Claude Code to author Vitest tests for the new logic, run `pnpm test` locally before pushing, and confirm the suite is green before opening the PR.

**Stage 3 — Review and iterate.** Claude Code pushes the feature branch and opens a pull request via `gh pr create`, with the description including `Closes #N` to auto-link the issue. Any PR that introduces or modifies a feature, integration, data flow, or architectural decision must also include an update to [docs/TechnicalGuide.md](docs/TechnicalGuide.md) in the same commit set — the doc update is part of the implementation, not a follow-up (see "Technical guide as living documentation" below). The PR triggers two automated signals: a Vercel preview deployment at a unique URL, and a GitHub Actions run of the Vitest suite that surfaces as a "Tests" check on the PR. Both should be green before merge, but neither is enforced as a hard block at the GitHub level (see "CI enforcement status" below) — the discipline of not merging when either signal is red rests with Todd. Review is a defined step, not an optional one. Todd tests the Vercel preview, visually confirms the Tests check is green in the PR UI, and reviews the diff in the GitHub UI. Todd then shares the PR URL with Claude (in the project chat) for a diff review covering consistency with existing patterns, convention adherence (Supabase client schema configuration, `.schema('hearth')` calls for shared-schema access, RLS patterns, frontend-design skill compliance), technical-guide updates that match what shipped, test coverage of new pure logic, and architectural soundness. If changes are needed, Claude Code makes additional commits to the same branch and the PR updates automatically — both Vercel and CI re-run.

**Stage 4 — Merge and close.** Once the preview deployment is verified, the Tests check is confirmed green, and the diff is approved, the PR is merged via the GitHub UI (or `gh pr merge --delete-branch`). The merge triggers Vercel's production deployment, GitHub auto-closes the referenced issue, and the feature branch is deleted. The commit history on main stays clean — one merge commit per logical change, each traceable back to its PR and originating issue.

**Core principles.** `main` is sacred and always deployable; feature branches are cheap, disposable sandboxes. Issues are the contract — if it's not in the issue, Claude Code shouldn't be doing it. Todd syncs project knowledge before prompting, and GitHub must be ahead of chat. Preview deployments and the CI Tests check are the dual safety signals that replace direct-to-main commits. Every merged PR should close at least one issue.

---

## Hearth-specific environment rules

These are non-obvious constraints from how Hearth is set up. Claude Code must respect them or it will silently break things.

**Shared Supabase project.** Hearth shares a Supabase project with another app (Echoes). Hearth's data lives in a dedicated `hearth` schema; `auth.users` and `public.profiles` are shared. This means:

- Every `CREATE TABLE`, `CREATE FUNCTION`, `CREATE INDEX`, etc. in migrations must be **explicitly schema-qualified** with `hearth.` — never bare table names. Bare names default to `public` and would create tables in the shared schema.
- Supabase client instances are configured with `db: { schema: 'hearth' }` as the default. Accessing shared tables (e.g., `profiles`) requires an explicit `.schema('public')` call.
- **Never run `supabase db pull`.** This would dump the other app's schema into Hearth's migration history. Migrations only flow Hearth → remote, never remote → Hearth.
- `supabase migration list` will show migrations from the other app in the Remote column with empty Local. This is expected visual noise, not an error.

**Local-first development.** Development runs against a local Supabase stack (`supabase start`) on the developer's machine. The remote project is the eventual production target but is not used for day-to-day work. This means:

- `.env.development.local` contains local Supabase URLs/keys and overrides `.env.local` for `next dev`.
- `vercel env pull` populates `.env.local` with production values; do not rely on those during local dev.
- The fast iteration loop is `supabase migration new` → edit SQL → `supabase db reset` (wipes local DB and re-applies all migrations).
- Migrations are pushed to remote (`supabase db push`) only when a feature is ready for production deployment, and only after explicit Todd approval.

**File and directory conventions.**

- Project root is `C:\WEBDEV\hearth` (Windows / PowerShell development environment).
- Flat structure — `app/`, `lib/`, `types/` at root. No `src/` directory. Do not introduce one.
- Package manager is `pnpm`. Do not use `npm` or `yarn` commands.
- Route protection uses `proxy.ts` (not `middleware.ts`) and `lib/supabase/proxy.ts`. Do not rename or replace with the older `middleware.ts` convention.

---

## Frontend design discipline

Hearth's UI work uses the `frontend-design` skill. Every Claude Code task that creates or modifies UI — components, pages, layouts, styling — must invoke and apply this skill before generating code. This is not optional and applies regardless of how "simple" the change appears.

The skill encodes design tokens, styling constraints, and aesthetic standards specific to this environment. Skipping it produces generic, AI-default UI that diverges from the rest of the app.

Prompts that involve frontend work should explicitly instruct Claude Code to:

1. Invoke the `frontend-design` skill before writing any UI code. If the skill isn't available in the current Claude Code session, stop and surface that — do not proceed with defaults.
2. Apply the design tokens and patterns defined there.
3. Match the visual language of existing Hearth components rather than introducing new patterns ad hoc.
4. Use Tailwind utility classes consistent with the rest of the codebase. Do not introduce inline styles, CSS modules, or styled-components without explicit approval.

---

## Technical guide as living documentation

The repo maintains a living technical guide at [docs/TechnicalGuide.md](docs/TechnicalGuide.md). It captures the actual current state of how Hearth is built — schema layout, data flows, integration points, routing and auth, conventions, and the reasoning behind non-obvious decisions. CLAUDE.md describes *how we work*; the technical guide describes *what we've built and why*. The two are complementary and neither replaces the other.

**Read it before starting work.** Every Claude Code task begins by reading [docs/TechnicalGuide.md](docs/TechnicalGuide.md) so that implementation aligns with existing patterns and prior decisions. This is a standing precondition — it applies whether the prompt mentions the guide or not, and whether the change feels "big" or "small." If the guide and the issue conflict, surface the conflict in a PR review comment before implementing; don't silently pick one.

**Update it as part of closing the loop.** Any PR that introduces or modifies a feature, integration, data flow, schema, or architectural decision must include the corresponding update to the technical guide in the same commit set. Treat the doc update as part of the implementation, not a follow-up task — a PR that ships code without a matching guide update is incomplete and should not be merged. The update should reflect the new state of the system, not narrate the change (chronology belongs in `git log` and PR descriptions, not in the living guide).

**What belongs in the guide.** Schema structure and the reasoning behind it; how external integrations are wired up (Supabase, OCR services, public-records APIs, AI providers); routing, auth, and middleware flows; conventions that aren't obvious from reading the code; decisions made and notable alternatives that were rejected. Keep it dense and current — prune sections that no longer reflect reality rather than letting stale notes accumulate.

**What does not belong.** Workflow rules and traps (those live in CLAUDE.md). Chronological change history (that's `git log` and PR descriptions). Per-task TODOs or speculative future work (those are GitHub issues). Trivial implementation details that are self-evident from the code.

**When updates aren't required.** Typo fixes, dependency bumps with no behavior change, internal renames that don't affect contracts, and pure refactors that preserve the documented architecture don't require a guide update. Anything that would surprise a future reader of the codebase — or that you yourself would want to know about coming in cold — does.

---

## AI-trap avoidance

Generative coding tools have predictable failure modes. Claude Code must actively avoid these traps when working on Hearth.

**Over-formatting and over-abstraction.** Do not introduce wrapper components, custom hooks, utility functions, or abstractions unless there are at least two concrete callers that need them. Premature abstraction is a maintenance tax with no benefit. Inline the code at the call site until duplication justifies extraction.

**Generic AI aesthetics.** Avoid the visual defaults that signal "AI wrote this": gradient backgrounds applied without purpose, oversized rounded corners on every element, lucide-react icons sprinkled decoratively, "Welcome to [Product]" hero sections, and Card-Card-Card grid layouts as the default for any data display. Match what's already in the codebase. If nothing exists yet, the `frontend-design` skill defines the baseline.

**Hallucinated APIs and types.** Do not assume the existence of Supabase client methods, Next.js APIs, or library functions without verification. If a method is not visible in the existing codebase or documented in the relevant library's current docs, look it up before using it. Hallucinated method calls compile-time-fail or runtime-fail silently.

**Schema drift.** When writing SQL or TypeScript types that reference the database, the migration file is the source of truth. Do not write code referencing tables, columns, or types that do not exist in a committed migration. If new database objects are needed, write the migration first, apply it locally with `supabase db reset`, regenerate types with `supabase gen types typescript --local`, and then write the application code against the regenerated types.

**Unsolicited features.** Claude Code implements what is in the issue. If a related improvement seems worthwhile during implementation, note it for a follow-up issue rather than including it in the current PR. Scope creep within a PR makes review harder and increases the chance of merging unintended changes.

**Untested logic claims.** If the issue specifies tests, the PR must include them and they must pass. Do not claim in a PR description that "this is straightforward and doesn't need tests" when the issue's contract said tests were required. If the test contract feels wrong, raise it as a review comment before implementing — don't silently skip.

---

## When to write unit tests

Tests live alongside the code they cover (`*.test.ts` next to the implementation file) and run via Vitest. Test discipline in Hearth is selective, not comprehensive — coverage exists where it earns its keep and is skipped where it would create maintenance burden without catching real bugs. The decision of whether new code warrants tests is made during issue authoring (Stage 1) and recorded in the issue itself, so Claude Code knows up front whether tests are part of the implementation contract.

**Write tests for:** pure functions with non-obvious logic, especially anything involving ranking, scoring, ordering, threshold application, fusion, classification, parsing, normalization, or extraction. Examples for Hearth: the public-records normalization that maps county-specific field names to canonical fields, the briefing-generation logic that decides what facts surface for a given property, the extraction-routing logic that decides which schema applies to an ingested document (receipt vs. appliance label vs. permit vs. manual), and any scoring that ranks "what matters" for proactive surfacing. These are deterministic given inputs, the logic is subtle enough that regressions would be silent, and a wrong result would never be caught by `pnpm build` or even careful manual testing on a Vercel preview. Bug fixes for logic errors should also include a regression test that fails on the old code and passes on the new — this prevents the same bug from returning during future refactors.

**Skip tests for:** I/O-heavy code where the interesting failures happen at the boundaries (Supabase queries, LLM API calls, Storage uploads, OCR service calls, public-records API calls). For these, manual verification on Vercel previews is the right tool. Also skip trivial getters/setters, thin wrappers around library calls, and React components whose value is primarily visual — these create maintenance burden disproportionate to the bugs they catch.

If a function is hard to test because it tangles pure logic with I/O, that's a signal to extract the pure logic into its own function. The test then covers the extracted logic, and the I/O wrapper stays untested. This refactor is itself a win regardless of whether tests are added.

**Running tests.** Locally, `pnpm test` runs the suite once and `pnpm test:watch` runs in watch mode for tight feedback during development. Claude Code is expected to run `pnpm test` before pushing any branch that adds or modifies tests, and to confirm the suite is green in the PR description. GitHub Actions runs the suite on every PR push and surfaces the result as a "Tests" check on the PR.

**Finding which tests cover the code you're about to edit.** Tests in Hearth are selective, which means there's no central registry of what's covered — the existence of coverage for a given file isn't obvious until you look. Three low-friction techniques, in order of effort:

1. **Glance at the file's directory.** Sibling `*.test.ts` lives next to the source file by convention; if it exists, open it and skim the assertions *before* changing the source. The test file is the contract the existing code is committed to — assertions about ordering, array length, exact return shapes, etc. are exactly the things that silently break when behavior changes. The radon affiliate-link incident (a third product action added to Zone 1's `buildActions` without updating the test that asserted a 3-item `[product, service, link]` shape) was a missed one-second check of this kind.
2. **`pnpm test --related <path/to/file.ts>`** walks Vitest's import graph and runs only the tests whose imports reach that source file (directly or transitively). Useful when the file has no sibling test but is consumed by tested code elsewhere — finds the coverage you might not know exists.
3. **Keep `pnpm test:watch` running** in a side terminal for any meaningful editing session. Every save re-runs only the affected tests in roughly a second, so regressions surface the moment they're introduced — no need to predict which tests are at risk before editing.

This applies equally whether the edit is being made by Claude Code or by Todd directly in the IDE.

**CI enforcement status.** The Tests check is currently advisory, not blocking. GitHub branch protection rules require a paid plan (GitHub Pro or Team) to be enforced on private repositories, and Hearth is on a free personal account. This means: the CI workflow runs and shows green/red on every PR (this part works on free repos), but the merge button is not automatically disabled when the check is red. Todd is responsible for visually confirming the Tests check is green before clicking merge. If a PR is ever merged with a red check by mistake — or if the workflow scales to multiple contributors — upgrading to GitHub Pro ($4/month) to enable enforced branch protection is the natural next step. Until then, the discipline is manual.

**TODD Reminder** Sometimes Todd may forget to change the local project back to the main branch, after merging a PR. So always double check that we're on the main branch before starting new tasks. He is trying his best to be disciplined in this area.
