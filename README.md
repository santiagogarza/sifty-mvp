# Sifty

Calm, AI-first productivity. Capture instantly. Sifty organizes the rest.

## Run

```bash
pnpm install
cp .env.example .env.local       # then fill in values
pnpm dev
```

Visit http://localhost:3000 — it redirects to `/today`.

Useful scripts:

```bash
pnpm dev          # Next.js dev server with Turbopack
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check
pnpm lint:fix     # biome check --write
pnpm test         # vitest unit + integration suite
pnpm test:e2e     # Playwright smoke (boots dev server)
pnpm db:generate  # produce a new Drizzle migration from lib/db/schema.ts
pnpm db:migrate   # apply migrations to DATABASE_URL
```

### Quickest local setup (no auth, no DB, no AI keys)

```bash
SIFTY_DISABLE_AUTH=1 SIFTY_AI_OFFLINE=1 pnpm dev
```

`SIFTY_AI_OFFLINE=1` routes triage and agent briefs through the
deterministic offline heuristic so the full loop works without a provider
key. Without it, AI routes fail clearly (503 `no_ai_key`).

### Demo workspace

```bash
SIFTY_DISABLE_AUTH=1 SIFTY_AI_OFFLINE=1 SIFTY_DEMO_SEED=1 pnpm dev
```

`SIFTY_DEMO_SEED=1` populates every new account (or the auth-bypass user)
with a fully-triaged workspace: a dozen tasks across Today/Inbox/Focus/
Waiting on/Someday/Done — labeled, prioritized, with subtasks, rationale,
confidence, one clarifying question, and one prepared agent brief — plus
pinned memories. Seeding is first-run only: an account with any existing
task or memory is never touched. It works with real sign-up too (each new
account gets the demo set), and with or without a database.

## Design philosophy

Sifty optimises three things, in this order:

1. **Calm.** The app should never shout. Empty states are quiet, motion is
   subtle, the type stack is generous. The single warm accent ("ember") is
   reserved for true urgency; "mist" is the AI hue and stays quiet.
2. **Instant capture.** The capture dialog is reachable from anywhere
   (`C` shortcut), opens with the textarea focused, and submits with
   `⌘↵`. The task is created synchronously and AI enrichment happens in
   the background — capture never blocks.
3. **AI you can argue with.** Every AI-derived field is editable, and every
   user edit is recorded so re-triage will not overwrite it. Rationale and
   confidence are visible in the detail sheet so you can disagree on
   evidence, not vibes.

## Production architecture

```
app/
  (app)/...                    # signed-in app shell + pages
  (auth)/sign-in, sign-up      # auth pages
  api/
    auth/{sign-in,sign-up,sign-out,me}/route.ts
    tasks/route.ts             # GET (list), POST (create, client ids ok)
    tasks/[id]/route.ts        # GET, PATCH, DELETE
    labels/route.ts            # GET, PUT (idempotent ensure-by-name)
    memories/...               # GET, POST, PATCH, DELETE
    triage/route.ts            # AI triage: gate → model → durable apply
    agent-brief/route.ts       # "Prepare for agent" handoff brief
    stripe/{checkout,portal,webhook}/route.ts
middleware.ts                  # gates /today, /focus, /inbox, /waiting,
                               # /someday, /done, /board, /memory, /settings
                               # on a JWT cookie

components/
  app-shell/                   # frame, sidebar, top bar, palette, bottom nav
  tasks/                       # capture, list, row, detail sheet, ai status
  auth/auth-form.tsx           # sign-in / sign-up shared form
  billing/billing-panel.tsx    # checkout + portal + tier display
  ui/                          # primitives

lib/
  ai/                          # models registry, provider resolver,
                               # generateObject-based triage agent, prompts,
                               # ai_runs accessor
  auth/                        # jwt, passwords (bcryptjs), service, session
  billing/                     # Stripe SDK singleton, pure event reducer
  db/
    schema.ts                  # Drizzle schema for users, entitlements,
                               # tasks, labels, task_labels, memories,
                               # task_events, ai_runs, sessions, stripe_events
    client.ts                  # lazy postgres-js client
    repos/                     # Postgres + in-memory implementations behind
                               # one Repos interface; swap via setReposForTesting
  demo/                        # SIFTY_DEMO_SEED workspace seeding
  domain/                      # types, schemas, priority utilities,
                               # shared triage merge (editedFields guard)
  entitlements/                # pure deriveEntitlement, canRunAi
  observability/report-error.ts# central error reporter (Sentry-ready seam)
  ratelimit/                   # token-bucket limiter + policies (triage,
                               # stripe webhook, stripe user)
  store/                       # Zustand store + server sync
  utils/                       # cn, dates, ids

drizzle/                       # generated SQL migrations
```

## Sync architecture

The Zustand store is the optimistic source of truth for the UI; Postgres is
the durable source of truth across devices.

- Every mutation (task capture/edit/delete, labels, memories) pushes to the
  API in the background: creates and deletes immediately, field edits
  debounced 400 ms, always full-entity last-writer-wins, per-entity ordered.
- A localStorage ledger marks entities dirty before each push (with
  tombstones for deletes). Pushes that never land — tab closed, offline —
  replay on the next mount.
- On mount the client pulls the server snapshot and reconciles: dirty-local
  wins, clean rows follow the server, tombstones are honored, and an
  account switch on a shared browser resets the local cache instead of
  leaking the previous user's workspace.
- Triage results are applied server-side by the triage route itself
  (respecting `editedFields`), so an enrichment survives even if the tab
  closes mid-run. Tasks left `pending`/`running` by an interrupted session
  auto-resume (bounded) on the next load.

## Configuration

Every environment variable lives in `.env.example` with descriptions.
Required for production:

| Variable | What it's for |
| --- | --- |
| `AUTH_SECRET` | HS256 key for the session JWT. ≥ 32 chars. |
| `CREATOR_EMAIL` | Email address that gets the permanent unlimited tier. |
| `DATABASE_URL` | Postgres connection (Vercel Postgres / Neon / Supabase). |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key — preferred path. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Direct fallback when no Gateway key. |
| `STRIPE_SECRET_KEY` | Stripe secret. Used by checkout, portal, webhook. |
| `STRIPE_WEBHOOK_SECRET` | HMAC verifier for the webhook endpoint. |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | Pro recurring price ids. |
| `NEXT_PUBLIC_APP_URL` | Public URL for Stripe success/cancel redirects. |

Optional:

- `SIFTY_DISABLE_AUTH=1` — local-dev escape hatch; bypasses auth in the
  middleware and `getSession`. Off in production.
- `SIFTY_DEMO_SEED=1` — populate new accounts with the fully-triaged demo
  workspace (first-run only; never touches existing data).
- `SIFTY_AI_OFFLINE=1` — keyless dev: AI routes use the deterministic
  offline heuristic instead of a provider.
- `RATELIMIT_TRIAGE_PER_MIN`, `RATELIMIT_STRIPE_USER_PER_MIN`,
  `RATELIMIT_STRIPE_WEBHOOK_PER_MIN` — token bucket capacity overrides.
  The triage cap is enforced twice: an in-process bucket per instance, and
  a persistent sliding window over `ai_runs` that holds across serverless
  instances.

## AI configuration

Triage runs through the [AI SDK](https://sdk.vercel.ai/) and validates
output against the `TriageOutput` Zod schema. The system prompt and
prompt builder are in `lib/ai/prompts.ts`; the model registry (Claude
Sonnet, Claude Haiku, GPT-4o, GPT-4o mini) is in `lib/ai/models.ts`.

Pinned memories from `/memory` are passed into the prompt as `User
preferences` — adding a memory like "I avoid deep work after 4pm"
demonstrably influences how the model triages later evening tasks.

If no provider key is set, the route returns 503 with `code: "no_ai_key"`.
The deterministic offline heuristic still works as an explicit debug
fallback via `/api/triage?offline=1` or `SIFTY_AI_OFFLINE=1` — useful for
keyless local dev, screenshots, and CI smoke runs.

"Prepare for agent" (`/api/agent-brief`) turns a task into a markdown
handoff brief — objective, context, steps, success criteria — stored on
the task and shown in the detail sheet with copy/regenerate. Same gates,
schema validation, and offline fallback as triage.

## Billing

- Checkout: `/api/stripe/checkout` (POST `{ cadence: "monthly" | "yearly" }`)
  creates the Stripe customer if needed, then a Checkout Session with
  `allow_promotion_codes: true`. Discount/comp codes you create in the
  Stripe Dashboard are redeemable end-to-end.
- Portal: `/api/stripe/portal` (POST) opens the Stripe Billing Portal
  for active subscribers.
- Webhook: `/api/stripe/webhook` verifies the `Stripe-Signature` HMAC,
  deduplicates by `event.id` in the `stripe_events` table, then runs the
  pure reducer in `lib/billing/events.ts` against the user's
  entitlement. Creator entitlement is sticky.
- UI: `/settings/billing` shows tier, trial countdown, Upgrade
  (monthly/yearly), Manage subscription.

## Pre-deploy smoke checklist

Run through this on the preview URL before promoting to production:

- [ ] Sign-up flow lands a fresh user on `/today`.
- [ ] Capture creates a task instantly; triage status flips from
      `running` to `ready`; rationale + confidence are populated.
- [ ] Editing a triage field protects it on re-triage (toggle re-triage,
      observe the field doesn't change).
- [ ] Settings → AI model picker change is reflected in `meta.model` on
      the next triage run.
- [ ] `/settings/billing` shows the trial countdown.
- [ ] Stripe Checkout completes with `4242 4242 4242 4242` and a
      promo code; webhook activates the entitlement.
- [ ] Forging a webhook signature returns 400.
- [ ] Replaying the same `event.id` returns 200 + `deduped: true` with
      no duplicate DB writes.
- [ ] Trial-expired account hits the AI route → 402 with the cap message.
- [ ] Bursting `/api/triage` past the per-minute cap returns 429 with
      `Retry-After`.
- [ ] Sentry / logs receive a structured `reportError(...)` payload from
      a forced server failure.
- [ ] Capture a task, clear site data (or use a second browser), sign in
      again — the task and its enrichment come back from the server.
- [ ] Editing a task offline (dev tools → offline) and reloading once back
      online replays the edit (dirty ledger).

## Testing philosophy

Tests in this repo justify their maintenance cost. We have tests for:

- Pure boundary logic — Zod schemas, the entitlement matrix, the Stripe
  event reducer, prompt builder.
- Server route contracts — input validation, entitlement gating, error
  mapping, `ai_runs` persistence, rate-limit enforcement, webhook HMAC +
  idempotency.
- Cross-tenant tenancy invariants on the repo layer (no cross-user reads
  or writes).
- Auth — sign-up / sign-in success and failure paths, middleware gating
  protected and public routes.
- One Playwright smoke per stage that exercises the happy path on the
  live server.

We do not test rendered output of every component, the deterministic
heuristic (it's a debug fallback, not a product feature), or LLM output
content (the schema parser is what we trust).

Pre-merge gate (also enforced in `.github/workflows/ci.yml`):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Views

Two ways to look at the same tasks, toggled from the segmented control in
the Board header (List ↔ Board):

- **List** — Today (a smart lens) plus one page per status (Inbox, Focus,
  Waiting on, Someday, Done), reachable from the sidebar and command palette.
- **Board** (`/board`) — a Kanban of the five routed statuses. Drag a card
  to another column to change its status; the move syncs like any edit and
  moving to/from Done toggles completion. Cross-column only — order within a
  column stays computed. Fully keyboard-drivable (see below) with
  screen-reader announcements for pickup/move/drop.

## Keyboard

| Key | Action |
| --- | --- |
| `c` | Capture |
| `/` | Open command palette |
| `⌘K` / `^K` | Open command palette |
| `⌘↵` | Submit capture |
| `↑/↓` (`j`/`k`) | Navigate task list |
| `Enter` | Open the highlighted task |
| `Space` | Board: pick up / drop the focused card |
| `←/→` | Board: move a picked-up card between columns |
| `Esc` | Close any overlay / cancel a board drag |

## License

Private — internal MVP.
