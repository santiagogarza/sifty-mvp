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
SIFTY_DISABLE_AUTH=1 pnpm dev
# triage will work with ?offline=1 (heuristic) or fail clearly without
# an AI provider key set
```

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
    auth/{sign-in,sign-up,sign-out}/route.ts
    tasks/route.ts             # GET (list), POST (create)
    tasks/[id]/route.ts        # GET, PATCH, DELETE
    memories/...               # GET, POST, PATCH, DELETE
    triage/route.ts            # AI triage with rate limit + entitlement gate
    stripe/{checkout,portal,webhook}/route.ts
middleware.ts                  # gates /today, /focus, /inbox, /waiting,
                               # /someday, /memory, /settings on a JWT cookie

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
  domain/                      # types, schemas, priority utilities
  entitlements/                # pure deriveEntitlement, canRunAi
  observability/report-error.ts# central error reporter (Sentry-ready seam)
  ratelimit/                   # token-bucket limiter + policies (triage,
                               # stripe webhook, stripe user)
  store/                       # Zustand store + server sync
  utils/                       # cn, dates, ids

drizzle/                       # generated SQL migrations
```

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
- `RATELIMIT_TRIAGE_PER_MIN`, `RATELIMIT_STRIPE_USER_PER_MIN`,
  `RATELIMIT_STRIPE_WEBHOOK_PER_MIN` — token bucket capacity overrides.

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
fallback when you call `/api/triage?offline=1` — useful for screenshots
and CI smoke runs that don't need a real model.

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
- [ ] Hard-refreshing `/today` while signed in keeps tasks; the localStorage
      seed never overwrites server state.

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

## Keyboard

| Key | Action |
| --- | --- |
| `c` | Capture |
| `/` | Open command palette |
| `⌘K` / `^K` | Open command palette |
| `⌘↵` | Submit capture |
| `↑/↓` (`j`/`k`) | Navigate task list |
| `Enter` | Open the highlighted task |
| `Esc` | Close any overlay |

## License

Private — internal MVP.
