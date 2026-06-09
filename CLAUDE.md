@AGENTS.md

## Hearth-specific environment rules

These are non-obvious constraints from how Hearth is set up. Claude Code must respect them or it will silently break things.

**Supabase project schema.** Hearth runs on its own dedicated Supabase project. Application data lives in the `hearth` schema; user identity uses the standard `auth.users` and `public.profiles` tables in this same project. This means:

- Every `CREATE TABLE`, `CREATE FUNCTION`, `CREATE INDEX`, etc. in migrations must be **explicitly schema-qualified** with `hearth.` — never bare table names. Bare names default to `public`, which is reserved for the profiles table and other Supabase-standard objects.
- Supabase client instances are configured with `db: { schema: 'hearth' }` as the default. Accessing tables outside the `hearth` schema (e.g., `profiles`) requires an explicit `.schema('public')` call.

**Remote-only development.** All environments — local `next dev`, Vercel previews, and production — connect to the same remote Supabase project. There is no local Supabase stack. This means:

- `.env.local` holds the remote Supabase URLs/keys; refresh it with `vercel env pull` when values change.
- The migration workflow is `supabase migration new` → edit SQL → review → `supabase db push` to apply against the remote DB. Never run `supabase db reset` — it would wipe the same database that previews and production read from.
- Migrations are pushed (`supabase db push`) only after explicit Todd approval, since the change takes effect everywhere at once.
- After a migration is pushed, regenerate types with `supabase gen types typescript` (against the remote project) and commit the updated types file alongside the migration.

**File and directory conventions.**

- Project root is `C:\WEBDEV\hearth` (Windows / PowerShell development environment).
- Flat structure — `app/`, `lib/`, `types/` at root. No `src/` directory. Do not introduce one.
- Package manager is `pnpm`. Do not use `npm` or `yarn` commands.
- Route protection uses `proxy.ts` (not `middleware.ts`) and `lib/supabase/proxy.ts`. Do not rename or replace with the older `middleware.ts` convention.

## Technical guide as living documentation

> **Hearth override of the per-user instructions.** Everything in the per-user "Technical guide as living documentation" section still applies — what belongs in the guide, what doesn't, when an update isn't required, and the rule that chronology lives in `git log` and PR descriptions rather than the guide. Hearth changes exactly one thing: the guide is a **hub + spokes**, not a single file. Wherever the per-user workflow says "read the technical-guide section," in Hearth that means the read order and update rule below.

**Read order.** Every task begins at the hub, [docs/TechnicalGuide.md](docs/TechnicalGuide.md) — which carries the stack, repository layout, cross-cutting invariants, frontend design system, environments/deployment, what isn't built yet, and a **Spoke index** — then reads the spoke(s) under [docs/architecture/](docs/architecture/) that the index points you at for the work in hand. This is a standing precondition: it applies whether or not the prompt mentions the guide, and whether the change feels big or small.

**Update rule.** A PR that changes a domain updates the relevant **spoke** under [docs/architecture/](docs/architecture/) in the same commit set. It touches the **hub** only when it changes something hub-level: a cross-cutting invariant, the stack, the repository layout, the design system, environments/deployment, or adding a new spoke.
