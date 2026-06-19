# AGENTS.md

Sifty — AI-first productivity app (Next.js App Router + TypeScript). See `PLAN.md` for the full product/bootstrap spec.

## Cursor Cloud specific instructions

### Stack & commands
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript, styled with Tailwind CSS v4, linted/formatted with Biome. Package manager is **pnpm**.
- Standard scripts live in `package.json`: `pnpm dev` (dev server on port 3000), `pnpm build`, `pnpm lint` / `pnpm lint:fix` (Biome), `pnpm typecheck` (`tsc --noEmit`). The `PLAN.md` "Verification" section refers to `biome`/`tsc`/`build`; those map to these scripts.

### Non-obvious caveats
- **Local-only persistence (dev stand-in):** Tasks are stored in a local JSON file at `.data/tasks.json` (gitignored) via `lib/store.ts`. This is a deliberate stand-in for the planned Supabase Postgres so the core capture loop runs with **no external secrets or database**. Deleting `.data/` resets all tasks.
- **AI triage is a local heuristic, not a model call:** `lib/ai/triage.ts` derives labels/urgency/effort/confidence with simple keyword rules. The plan calls for the Vercel AI Gateway, but capture must "degrade gracefully" without AI — this fallback keeps the capture → enrich → review loop fully runnable offline. Wiring the real AI Gateway / Supabase / Stripe / Trigger.dev integrations from `PLAN.md` is future work and will require their respective secrets (none are configured yet).
- **Biome + Tailwind v4:** Biome's CSS parser cannot parse Tailwind v4's `@theme` at-rule, so `app/globals.css` is excluded from Biome in `biome.json`. Do not remove that exclusion unless Biome adds support, or `pnpm lint` will fail to parse the global stylesheet.
- **tsconfig is managed by Next.js:** `next build`/`next dev` may rewrite parts of `tsconfig.json` (e.g. `jsx`, generated type globs). This is expected.
