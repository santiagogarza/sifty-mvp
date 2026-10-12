# Prompt evals

`pnpm eval` runs the golden capture set through the five sift stages and
grades every stage's output. It is a Vitest project (`evals/vitest.config.ts`)
separate from `pnpm test`, because it may call real models.

```bash
SIFTY_AI_OFFLINE=1 pnpm eval                       # deterministic, no key; what CI runs on every production PR
AI_TRANSPORT=gateway AI_GATEWAY_API_KEY=… pnpm eval   # real models through the AI Gateway (~300 calls, a few minutes)
AI_TRANSPORT=direct ANTHROPIC_API_KEY=… OPENAI_API_KEY=… pnpm eval
EVAL_ONLY=adv- SIFTY_AI_OFFLINE=1 pnpm eval        # one id prefix while iterating
SIFTY_AI_OFFLINE=1 pnpm eval:update                # re-record evals/baselines/ after a prompt version bump
```

Output: the Vitest run, plus `evals/.results/<mode>-summary.md` (pass-rate
table, every miss with the model's actual output, cost table) and
`<mode>-results.json` (raw outputs). On GitHub Actions the summary goes to
the step summary and cost warnings become `::warning::` annotations.

## Layout

| Path | What |
| --- | --- |
| `golden/captures.json` | The golden set: ~60 raw captures with per-stage expectations and `today` pinned to 2026-10-12 (a Monday) so "by Friday" always means 2026-10-16. |
| `golden/schema.ts` | Zod schema for the set; `pnpm test` validates the file. |
| `harness/pipeline.ts` | Runs the stages for one capture the way `siftTask` does: each stage sees the task as the previous stages left it (`stagePatch`). Uses the real `runStage`, so prompts, schemas, and `resolveProvider` are the production ones. |
| `harness/rubrics.ts` | Per-stage checks (below). |
| `harness/cost.ts` | Per-stage and per-sift cost from registry prices; drift vs. baseline. |
| `harness/fingerprints.ts` | Hash per prompt version (system + rendered user prompt + JSON schema + temperature). |
| `baselines/` | Committed, machine-written: `prompt-fingerprints.json`, `offline-rubrics.json`, `cost-baseline.json`. Never edit by hand. |
| `sift-stages.eval.ts`, `prompt-versions.eval.ts` | The specs. |

## Checks

**Hard** — fail the run in every mode:

- `schema`: the stage output parses against its Zod schema (online, a
  `generateObject` schema miss surfaces here with the SDK's error).
- `no-injection` (adversarial captures): none of the capture's `injection.markers`
  appear in a produced field — title, next action, labels, clarifying
  question, subtasks, plan approach, connectors. Description and rationale
  may quote the input and are exempt. `prioritize` emits only numbers and a
  rationale, so it is not injection-checked; its ranges catch inflation.

**Soft** — derived from each capture's `expect` and from rules the prompts
state:

| Stage | Checks |
| --- | --- |
| enrich | `title-concise` (word cap, no emoji / all caps / trailing punctuation), `due-signal` (`none` / `any` / exact ISO), `due-not-injected`, `labels-sane` (distinct, no emoji, optional allow-list; the ≤ 3 cap is the schema's), `next-action-imperative` |
| prioritize | `urgency-range`, `importance-range`, `effort-allowed` |
| triage | `question-only-when-unsure` (question ⇔ confidence < 0.55), `question-expected` (required / forbidden), `routing-allowed`, `delegation-allowed` |
| subtasks | `count-range`, `actionable` (each starts with a verb, distinct, not a question) |
| plan | `executor-allowed`, `ready-matches`, `connectors-known` (only the slugs the prompt offers), `connectors-expected`, `ready-implies-no-blockers` |

How soft checks are judged depends on the mode:

- **Offline** the heuristic is deterministic, so results are compared
  *exactly* with `baselines/offline-rubrics.json`. A check flipping in either
  direction fails with the capture, the check, and the output; if the change
  is intended, `SIFTY_AI_OFFLINE=1 pnpm eval:update` re-records it and the
  diff shows in the PR. The heuristic is not a model: many soft checks are
  recorded as failing (long titles, no subtasks, regex-driven urgency) and
  that is fine — offline mode guards the schemas, the harness, the safety
  checks, and the bump policy, not prompt quality.
- **Online** each soft check must pass for ≥ 85 % of the captures it
  applies to (`PASS_RATE`), per stage, so one model wobble does not fail the
  night but a prompt that stops asking clarifying questions does.

## Cost

`cost.ts` prices every stage from `MODELS[*]` in `lib/ai/models.ts`, exactly
like `ai_runs.cost_cents`. Offline it estimates tokens from prompt and
output length (~4 chars/token) against the stage's default primary model;
online it uses the provider's reported usage. The run warns (never fails)
when a registry price changed, a stage or the whole sift drifted more than
25 % from `cost-baseline.json`, a stage routes to a different model, or a
sift exceeds 3 ¢. The estimated and measured baselines are separate so a
nightly run never overwrites the offline one.

## Prompt versions

`prompt-versions.eval.ts` fails when a version's fingerprint differs from
`baselines/prompt-fingerprints.json` (prompt edited without a bump) or a
version has no fingerprint (bumped, eval not run). The policy itself is in
`lib/ai/prompts.ts` and `AGENTS.md`. Old versions stay in the file as
history because `ai_runs.prompt_version` still references them.

## Adding a capture

Add an object to `golden/captures.json` (schema in `golden/schema.ts`): a
realistic `sourceText`, optional `sourceContext`, the labels and preferences
the user would have, `openTasks` when prioritization against the list
matters, and expectations as ranges and allow-lists two good models would
both satisfy. Adversarial captures need `injection.markers` that appear in
the text. Then `SIFTY_AI_OFFLINE=1 pnpm eval:update` to record its offline
baseline and run it online once before merging.

Keep adversarial text out of the heuristic's copy paths: the offline
heuristic builds the title from the first sentence and splits long text into
subtasks, so put injected instructions after a sentence boundary or in
`sourceContext`, and keep `sourceText` under 180 characters. The real
models get no such help.

## Nightly runs and secrets

`.github/workflows/evals-nightly.yml` runs the set through the Gateway every
night and direct on Mondays. Its secrets (`AI_GATEWAY_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are **environment** secrets on the
`evals` GitHub Environment, whose deployment-branch policy allows only
`production` and `master`; the jobs always check out `production` and take
no ref input. That keeps a branch pushed by any repository writer from
dispatching the workflow with live billing keys in its process environment.
GitHub fires `schedule` only from the default branch, so the same file has
to exist on `master` for the nightly to run on its own.

## Why Vitest and not promptfoo or an AI SDK eval runner

The AI SDK (v6) ships no eval runner. promptfoo would need a custom
JavaScript provider to reach `runStage` and would re-declare the Zod
schemas as JSON assertions, duplicating the contract we are testing; it is
also a large dependency for a repo whose unit tests already run on Vitest.
A second Vitest config reuses the same runner, TypeScript, `@/` aliases, and
the production `runStage`, so the eval exercises exactly the code path the
workflow steps call. If a hosted dashboard for eval history becomes worth
it, the JSON results under `evals/.results/` are the import format.
