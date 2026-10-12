# Sifty

Calm, AI-first productivity. Capture instantly. Sifty organizes the rest.

> **Branches:** `production` is the live product (Vercel deploys from it);
> `master` is the fresh pre-demo baseline; `demo-done` and `dragging-bug`
> are demo branches. Read [`BRANCHES.md`](./BRANCHES.md) before opening a PR.

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
pnpm invite:mint  # mint an invite code (see Billing → Invite codes)
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
  (auth)/sign-in, sign-up,     # auth pages
         forgot-password, reset-password
  api/
    auth/[...all]/route.ts     # Better Auth (sign-in/up, verify, reset,
                               # magic link, Google callback, sessions)
    auth/me/route.ts           # who am I (sync layer)
    tasks/route.ts             # GET (list), POST (create, client ids ok)
    tasks/[id]/route.ts        # GET, PATCH, DELETE
    labels/route.ts            # GET, PUT (idempotent ensure-by-name)
    memories/...               # GET, POST, PATCH, DELETE
    triage/route.ts            # AI triage: gate → model → durable apply
    agent-brief/route.ts       # "Prepare for agent" handoff brief
    stripe/{checkout,portal,webhook}/route.ts
middleware.ts                  # gates /today, /focus, /inbox, /waiting,
                               # /someday, /memory, /settings on the session
                               # cookie; (app)/layout.tsx validates it

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
  auth/                        # Better Auth instance (Drizzle adapter,
                               # email+password, magic link, Google, hooks),
                               # getSession(), legacy bcrypt verifier
  billing/                     # Stripe SDK singleton, pure event reducer
  email/                       # EmailProvider seam (Resend | console),
                               # React Email templates, sendTemplate()
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
  abuse/                       # Vercel BotID wrapper (sign-up, invite redeem)
  ratelimit/                   # fixed-window limiter (Upstash Redis or
                               # in-process) + per-route IP/user policies
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
| `BETTER_AUTH_SECRET` | Signs session cookies and email tokens. ≥ 32 chars. Replaces `AUTH_SECRET`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in. Optional: the button is hidden until both are set. Redirect URI: `<app url>/api/auth/callback/google`. |
| `CREATOR_EMAIL` | Email address that gets the permanent unlimited tier. |
| `INVITE_CODE_PEPPER` | Pepper for invite-code hashes (`openssl rand -hex 32`). |
| `DATABASE_URL` | Postgres connection, pooled (Neon via Vercel Marketplace). Production refuses to build or boot without it; elsewhere the app runs in memory. |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations; falls back to `DATABASE_URL`. |
| `AI_TRANSPORT` | `gateway` (default) or `direct`. Explicit; never inferred from keys. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key. Required when `AI_TRANSPORT=gateway`. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Required when `AI_TRANSPORT=direct` (every stage has an OpenAI fallback). |
| `STRIPE_SECRET_KEY` | Stripe secret. Used by checkout, portal, webhook. |
| `STRIPE_WEBHOOK_SECRET` | HMAC verifier for the webhook endpoint. |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | Pro recurring price ids. |
| `NEXT_PUBLIC_APP_URL` | Public URL for Stripe success/cancel redirects. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email via Resend. `EMAIL_FROM` must be on a domain verified in Resend; `onboarding@resend.dev` works for testing and reaches the account owner only. Unset both and every email is printed to the server log instead (links included). |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional. Server and browser error sinks; everything is a no-op when unset. |

Optional:

- `EMAIL_REPLY_TO` — Reply-To on outgoing mail (support mailbox).
- `SIFTY_DISABLE_AUTH=1` — local-dev escape hatch; bypasses auth in the
  middleware and `getSession`.
- `SIFTY_DEMO_SEED=1` — populate new accounts with the fully-triaged demo
  workspace (first-run only; never touches existing data).
- `SIFTY_AI_OFFLINE=1` — keyless dev: AI routes use the deterministic
  offline heuristic instead of a provider.
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or the Marketplace
  `KV_REST_API_URL` / `KV_REST_API_TOKEN`) — when set, every rate limit is
  a fixed window in Upstash Redis shared by all instances; when unset, the
  same limits run in-process per instance. AI routes are additionally
  bounded by a persistent sliding window over `ai_runs` either way.
- `RATELIMIT_*_PER_MIN` — per-minute cap overrides, see `.env.example`.
  Each protected route (`/api/auth/*`, `/api/invites/redeem`,
  `/api/stripe/*`, `/api/triage`, `/api/agent-brief`) has a per-user (or
  per-email) cap and a wider per-IP cap; `POST /api/auth/*` is capped per IP
  in `middleware.ts`. Limited requests get `429` with `Retry-After`.
- `SIFTY_DISABLE_BOTID=1` — turn off the Vercel BotID check on sign-up and
  invite redemption. The check only runs on Vercel deployments anyway.

Dev-only switches (`SIFTY_DISABLE_AUTH`, `SIFTY_DEMO_SEED`, `SIFTY_AI_OFFLINE`,
`SIFTY_USER_EMAIL`) are refused when `VERCEL_ENV=production`: the build
(`next.config.ts`) and the server (`instrumentation.ts`) throw
`ProductionEnvError`, and `demoFlagEnabled()` in `lib/env/production-guards.ts`
ignores them regardless. Same for the in-memory store: production requires
`DATABASE_URL` (the build and the boot both refuse without it). On Vercel the
build command is `pnpm build:vercel`, which runs `pnpm db:migrate` (skips when
no database is configured outside production, and always on preview
deployments) before
`next build`. `vercel.json` carries the security headers, the cron schedule
(daily `expire-grace-periods`; Hobby allows daily crons only), and the Ignored Build Step (`scripts/vercel-ignore-build.sh`:
only `production` and `cursor/prod-*` build). `GET /api/health` is the
uptime probe (200/503, reports persistence, DB reachability, Sentry).

## AI configuration

Triage runs through the [AI SDK](https://sdk.vercel.ai/) and validates
output against the `TriageOutput` Zod schema. The system prompt and
prompt builder are in `lib/ai/prompts.ts`.

The model registry (`lib/ai/models.ts`) keys models by canonical
`provider/model` slug and declares, per pipeline stage (`enrich`,
`prioritize`, `triage`, `subtasks`, `plan`, `execute`, `digest`), a primary
model, an ordered fallback list, and list prices. Defaults: Claude Haiku 4.5
for the cheap stages, Claude Sonnet 4.5 for `plan`/`execute`, one OpenAI
fallback per stage. Settings → AI model is a *preference* (Recommended, Best
quality, Fastest, Prefer OpenAI) that remaps stages by class; the UI never
sees raw model ids.

`lib/ai/provider.ts` is the only module that imports a provider SDK.
`resolveProvider(stage)` returns an AI SDK model with the fallbacks baked
in for the configured `AI_TRANSPORT`: in `gateway` mode the fallback list
is passed to the Gateway as a routing option; in `direct` mode an
in-process wrapper fails over on retryable provider errors. Every
`ai_runs` row records `stage`, `transport`, the model that actually
answered, tokens, and `cost_cents` (fractional) priced from the registry,
so spend reporting works identically in both modes.

Pinned memories from `/memory` are passed into the prompt as `User
preferences` — adding a memory like "I avoid deep work after 4pm"
demonstrably influences how the model triages later evening tasks.

If the configured transport is missing its key, the route returns 503 with
`code: "no_ai_key"` (an invalid `AI_TRANSPORT` value gives `ai_misconfigured`).
The deterministic offline heuristic still works as an explicit debug
fallback via `/api/triage?offline=1` or `SIFTY_AI_OFFLINE=1` — useful for
keyless local dev, screenshots, and CI smoke runs.

"Prepare for agent" (`/api/agent-brief`) turns a task into a markdown
handoff brief — objective, context, steps, success criteria — stored on
the task and shown in the detail sheet with copy/regenerate. Same gates,
schema validation, and offline fallback as triage.

## Billing

Tiers (`lib/entitlements/entitlements.ts`), lowest to highest; when several
facts apply the highest wins (`creator > comped > pro > trialing > free`):

| Tier | Who | Sifts/day | Execution budget | Connectors |
| --- | --- | --- | --- | --- |
| `free` | Everyone after the trial | 5 | — | no |
| `trialing` | New sign-ups, 30 days of Pro | 200 (fair use) | $10/mo | yes |
| `pro` | Paying via Stripe | 200 (fair use) | $10/mo | yes |
| `comped` | Pro granted by an invite code, no Stripe | 200 (fair use) | $10/mo | yes |
| `creator` | `CREATOR_EMAIL` | unlimited | unlimited | yes |

Capture, organize, sync, and reminders are free for every tier. The
`entitlements` row stores facts (trial window, `subscription_active`,
`comped_at`/`comped_until`); `deriveEntitlement()` resolves the effective
tier and its caps at read time, and `canRunAi()` gates on `caps.siftsPerDay`.
AI routes answer `402` with `code: "free_cap"` (upgrade path) or
`"fair_use_cap"` (Pro ceiling).

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
- UI: `/settings/billing` shows tier, sifts used today, trial countdown,
  Upgrade (monthly/yearly), Manage subscription, and invite-code redemption.

### Invite codes

Invite codes grant `comped` (Pro without Stripe). Stripe promo codes stay for
percentage discounts at checkout; invite codes are for family, friends, and
anyone who should never enter a card.

```bash
pnpm invite:mint --months 12 --max 1 --expires 2027-06-30 --note "Ana"
pnpm invite:list
pnpm invite:revoke sifty-… [--cascade]   # --cascade also ends redeemers' comps
```

- Format: `sifty-` + 20 characters from an alphabet without 0/O/1/l/I
  (~117 bits). Only `sha256(INVITE_CODE_PEPPER + code)` is stored; the
  plaintext is printed once at mint time.
- `--months` omitted means forever; stacking a second timed code extends
  from the current comp end. `--max` is the redemption cap across users;
  each user can redeem a given code once.
- Redeem at `/redeem?code=sifty-…` (signed-out visitors go through sign-in
  or sign-up and land back on the code) or in Settings → Billing. The API,
  `POST /api/invites/redeem`, is rate-limited per user and per IP and
  checked with BotID.
- Requires `DATABASE_URL` and `INVITE_CODE_PEPPER`; both the CLI and the app
  must use the same pepper.

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
- [ ] Free account past 5 sifts hits the AI route → 402 with
      `code: "free_cap"` and the upgrade message.
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
- Auth — sign-up, email verification, sign-in gating on verification,
  password reset (with session revocation), magic link, per-session and
  all-other-sessions revocation, legacy bcrypt import; middleware gating
  protected and public routes. All against Better Auth's memory adapter and
  the console email outbox.
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
