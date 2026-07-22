# AGENTS.md

## Cursor Cloud specific instructions

Sifty is a single Next.js 15 app (App Router, Turbopack) — there is no separate
backend service. Node 22 + pnpm 10 are used (matches `.github/workflows/ci.yml`).
Dependencies are refreshed automatically by the environment update script
(`pnpm install --frozen-lockfile`), so you should not need to install them.

### Running the app (no DB, no auth, no AI keys required)

The app runs fully offline. When `DATABASE_URL` is unset it falls back to
in-memory storage (data is lost on restart). Use the documented dev flags:

```bash
AUTH_SECRET=ci-auth-secret-do-not-use-in-production-please-32 \
CREATOR_EMAIL=s.gonzalez.garza@gmail.com \
SIFTY_DISABLE_AUTH=1 SIFTY_AI_OFFLINE=1 SIFTY_DEMO_SEED=1 pnpm dev
```

- `SIFTY_DISABLE_AUTH=1` bypasses the middleware auth gate (otherwise every
  route redirects to `/sign-in`).
- `SIFTY_AI_OFFLINE=1` routes triage / agent-brief through the deterministic
  offline heuristic. Without it, AI routes return `503 no_ai_key`.
- `SIFTY_DEMO_SEED=1` seeds the bypass user with a fully-triaged workspace
  (first-run only). Handy for GUI demos; omit for a clean slate.
- `AUTH_SECRET` (≥32 chars) is required even with auth disabled — the JWT
  module reads it at startup. `CREATOR_EMAIL` is also expected.

The app serves on `http://localhost:3000` and `/` redirects to `/today`.

### Non-obvious gotchas

- The UI is an optimistic Zustand store that syncs to the server in the
  background; a freshly captured task can briefly render twice while triage
  reconciles, then settles. Reload to see the stable state — this is a
  transient render artifact, not data duplication (the `/api/tasks` snapshot
  is always de-duplicated).
- Standard scripts (`lint`, `typecheck`, `test`, `test:e2e`, `db:*`) are in
  `package.json`; the full pre-merge gate is documented in `README.md` and
  `.github/workflows/ci.yml`.

### Tests

- `pnpm test` (vitest) needs no env — `tests/setup.ts` supplies `AUTH_SECRET`
  and `CREATOR_EMAIL` defaults and swaps in in-memory repos per test.
- `pnpm test:e2e` (Playwright) boots its own `pnpm dev` webServer. It requires
  the Chromium browser (`pnpm test:e2e:install`, not part of the update script)
  and the env flags `AUTH_SECRET`, `CREATOR_EMAIL`, `SIFTY_DISABLE_AUTH=1`,
  `SIFTY_AI_OFFLINE=1`. The rate-limit burst test skips itself when it never
  observes a 429 — a skip there is expected, not a failure.
