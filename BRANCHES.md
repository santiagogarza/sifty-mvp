# Branches

Sifty has one production branch and three demo branches. They serve different
purposes and must not be mixed. Read this before opening a PR or pushing.

| Branch | Role | Deployed? | Changed by |
| --- | --- | --- | --- |
| `production` | The live product. Vercel deploys from here. | Yes — Vercel production | PRs into `production` |
| `master` | Fresh pre-demo baseline. Default branch. | No | PRs into `master`, demo-baseline changes only |
| `demo-done` | Finished state of the demo, run locally on a second port for before/after. | No | Demo setup script (reset), not PRs |
| `dragging-bug` | Deliberately broken state used to demo Debug Mode. | No | Demo setup script (reset), not PRs |

## `production`

- The real Sifty: user accounts, billing, AI features, production quality.
- All product work targets this branch. Open a PR into `production`.
- Vercel's Production Branch setting must be `production`; once set, every
  merge to `production` deploys.
- CI runs on PRs into `production`.
- May diverge freely from `master`. It is expected to grow features
  `master` never gets.

## `master`

- The pre-demo baseline Santi starts live demos from. It must stay "fresh":
  no half-built features, no production-only surface area.
- Only demo-baseline changes land here (fixes to the demo flow, docs,
  tooling that the demo setup depends on). Open a PR into `master`.
- CI runs on PRs into `master`.

## `demo-done` and `dragging-bug`

- Demo branches. `demo-done` is the finished state; `dragging-bug` contains
  the bug Debug Mode fixes on stage.
- The demo setup script (see https://github.com/santiagogarza/demos) resets
  them locally. Do not open PRs against them and do not rebase them onto
  `production`.

## Never

- Never merge `production` into `master`. That destroys the demo baseline.
- Never land production-only features on `master`.
- Never run demo reset scripts against `production`.
- Never force-push `production`.

## Getting a `master` fix into `production`

Fixes that belong on both branches land on `master` first, then flow
forward:

```bash
git checkout production
git pull origin production
git merge master            # or cherry-pick the specific commit
git push origin production  # via PR if branch protection requires it
```

The direction is always `master` → `production`, never the reverse.

## Agents and bots

Automated agents (Cursor Cloud Agents, Bugbot, CI) follow the same rules:
product work → `production`; demo-baseline work → `master`; leave the demo
branches alone. When unsure which branch a change belongs on, ask before
opening the PR.
