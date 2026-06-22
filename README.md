# Sifty

Calm, AI-first productivity. Capture instantly. Sifty organizes the rest.

This is the MVP bootstrap of the Sifty product, scoped to the personal-use
loop: capture → triage → review → act. The plan is in
[PLAN.md](./PLAN.md); this README focuses on running the app and the
shape of the codebase.

## Run

```bash
pnpm install
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
```

## Design philosophy

Sifty's MVP optimises three things, in this order:

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

## Shape of the codebase

```
app/
  (app)/                         # signed-in app shell + pages
    layout.tsx                   # mounts AppFrame (sidebar, overlays)
    today | focus | inbox |      # view pages — all tiny, structure
    waiting | someday |          # comes from <TaskView />
    memory | settings/page.tsx
  api/triage/route.ts            # AI triage endpoint (offline-safe)
  globals.css                    # design tokens + base layer
  layout.tsx                     # root layout, theme boot script

components/
  app-shell/                     # frame, sidebar, top bar, palette,
                                 # bottom nav, theme provider, global keys
  tasks/                         # capture-dialog, task-row, task-list,
                                 # task-detail-sheet, priority-glyph,
                                 # ai-status, empty-state
  ui/                            # primitives: button, dialog, sheet,
                                 # popover, badge, input, kbd, tooltip,
                                 # skeleton

lib/
  domain/                        # types, schemas, priority utilities
  store/                         # zustand store + selectors + seeds
  ai/                            # triage schema, prompts, agent (with
                                 # deterministic offline heuristic),
                                 # client-side run-triage driver
  auth/session.ts                # creator-bypass session boundary
  entitlements/entitlements.ts   # creator + 30-day trial entitlement
  utils/                         # cn, dates, ids
```

## What's implemented

- **App shell**: sidebar (md+), bottom nav (mobile), sticky top bar with
  command palette + capture, dark/light/system theme, global shortcuts
  (`C` capture, `/` palette, `⌘K` palette).
- **Capture flow**: dialog with primary textarea + optional context, cmd+enter
  submit, instant task creation, non-blocking triage.
- **Views**: Today, Focus, Inbox, Waiting, Someday, Memory, Settings.
  Each view shares one `TaskView` component; the differences are pure
  selectors.
- **Task detail sheet**: editable title, next action, priority sliders,
  effort, due-date popover, lifecycle, delegation, labels with picker,
  subtasks, AI rationale + confidence + clarifying-question reply,
  original capture, retry triage, delete.
- **AI triage**: structured Zod schema (`triage.v1`), system prompt and
  prompt builder, deterministic offline triage with explainable
  rationales (no API key required to demo), online provider stub ready
  for AI Gateway / OpenAI wiring.
- **Persistence**: client-authoritative Zustand store with localStorage
  persistence. Easy to swap for Supabase by replacing the store layer.
- **Entitlements**: creator-email bypass, 30-day trial, AI usage cap, all
  centralised in `lib/entitlements`.

## What's intentionally not implemented yet

- Real Supabase auth, Postgres, and realtime sync. The session and store
  boundaries are designed so the swap is local.
- Stripe webhooks. Entitlement plumbing is in place; the webhook handler
  will replace the in-memory derivation.
- Trigger.dev for durable background jobs. Triage already runs on the
  server via a route handler; the driver can be moved to a queue without
  changing the UI.
- Automatic delegation to external agents. The data model captures the
  recommendation; the manual "Prepare for agent" handoff is the next
  phase.

## AI configuration

Out of the box, triage runs locally with a deterministic, explainable
heuristic. Every inferred field traces back to a rule and the rationale
shown in the detail sheet reflects what fired.

To wire a real provider, set `AI_GATEWAY_API_KEY` (or `OPENAI_API_KEY`)
in `.env.local` and implement the `runOnline` branch in
`lib/ai/triage-agent.ts`. The Zod schema (`TriageOutput`) is the
contract; downstream code stays unchanged.

## Theming

Tokens are in `app/globals.css` and follow a two-layer pattern:

1. A neutral palette (`paper-*`) plus two accent palettes (`ember-*` for
   commit/important, `mist-*` for AI) live as `@theme` variables.
2. Semantic variables (`--bg`, `--fg`, `--surface`, `--accent`, `--ai`,
   etc.) reference the palette and are what components consume. This is
   what makes light/dark and future themes a one-file change.

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
