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

## Linear

Use the `linear-sifty` MCP server only (workspace sifty-demo, team SIF). See
`.cursor/rules/linear-workspace.mdc`.
