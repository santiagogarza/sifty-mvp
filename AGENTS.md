# Sifty — agent guide

## Branches (read first)

See [`BRANCHES.md`](./BRANCHES.md). In short:

- `production` is the live product, deployed by Vercel. Product work goes
  there via PRs into `production`.
- `master` is the fresh pre-demo baseline. Only demo-baseline changes land
  on it.
- `demo-done` and `dragging-bug` are demo branches reset by the demo setup
  script. Never PR into them.
- Never merge `production` into `master`. Never land production-only
  features on `master`. Never run demo reset scripts against `production`.
- Merging: PRs into `production` are squash-merged by their author once CI
  is green, Bugbot has no blocking comments, and the "Sifty Merge Gate"
  review says ship. PRs into `master` (and any change to `demo-done` /
  `dragging-bug`) are merged only by Santi, never by agents.

Pick the target branch before you start; if the right branch is unclear, ask.

## Verify before finishing

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Keyless local dev: `SIFTY_DISABLE_AUTH=1 SIFTY_AI_OFFLINE=1 pnpm dev`. See
`README.md` for the full setup, architecture, and testing philosophy.

## Prompts: version bump policy

Every prompt in `lib/ai/` has a `promptVersion` (`enrich.v1`, `triage.v2`,
`brief.v1`, …) recorded on each `ai_runs` row. Full policy in
`lib/ai/prompts.ts`; the short form:

- Any change to a system prompt, user prompt template, output schema, or
  temperature bumps that prompt's version in the same change. No exceptions
  for wording.
- Every bump ships with an eval run: `SIFTY_AI_OFFLINE=1 pnpm eval:update`
  (re-records `evals/baselines/`, commit the result) plus a real-model run
  (`AI_TRANSPORT=gateway AI_GATEWAY_API_KEY=… pnpm eval`, or the "Evals
  (real models)" workflow by hand) whose pass-rate table goes in the PR.
- CI runs `pnpm eval` offline on every `production` PR and fails on a
  prompt whose fingerprint moved without a bump, a schema miss, or a rubric
  regression against the recorded baseline. Cost drift is a warning.
- Never hand-edit files under `evals/baselines/`. Add captures to
  `evals/golden/captures.json` when a prompt bug is found; see
  `evals/README.md`.

## Linear

Use the `linear-sifty` MCP server only (workspace sifty-demo, team SIF). See
`.cursor/rules/linear-workspace.mdc`.
