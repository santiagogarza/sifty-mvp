# Review: review-sync-demo-45c2-b7e2

Branch: `cursor/sync-demo-production-fixes-45c2` vs `master`
Scope: full branch diff (client→server write sync, labels persistence, durable triage, agent briefs, demo seed, auth-bypass bootstrap, AI gate, settings split, PWA icons, tests).

## Run 1 — 2026-07-21 08:05 UTC

Verification performed: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm vitest run` 64/64 pass. Cross-tenant repo findings (#1) reproduced with a scratch vitest file against `createMemoryRepos()` (both assertions failed as predicted; scratch file deleted).

### 1. [Critical] `labels.ensure` / `memories.create` mishandle client-supplied id conflicts — cross-tenant overwrite (memory repo) or unhandled 500 (pg)
**Files:** `lib/db/repos/memory.ts` L304-L318, L327-L346; `lib/db/repos/pg.ts` L205-L228, L417-L438
- In-memory `labels.ensure` never checks whether `input.id` already exists: `state.labels.set(input.id, {…, userId})` silently **steals another tenant's label row** (verified: user A's label disappears from `labels.list(A)` after user B ensures with the same id). Same for `memories.create`: the pre-check is scoped to `userId === userId`, so another tenant's id falls through and is overwritten (verified: A's memory destroyed).
- Postgres `labels.ensure`: PK conflict → `onConflictDoNothing()` → re-select by (userId, name) finds nothing → `rowToLabel(row!)` TypeErrors → 500. Postgres `memories.create`: pre-check is user-scoped, insert has no conflict handling → raw PK-violation 500.
- Both endpoints are reachable by any authenticated user with an arbitrary id (`PUT /api/labels`, `POST /api/memories`). `tasks.create` got the `TaskIdConflictError`/409 treatment; labels and memories did not. On the client, a 4xx/5xx push returns `false` → entity stays dirty → replayed on every mount → infinite retry.
**Fix:** For labels, make conflicts impossible by construction: never insert the client id — `ensure` should mint a server id on the insert path (the client already adopts a different returned id via `pushLabelJob`'s remap). For memories, mirror the task contract: global id lookup, cross-tenant → typed conflict error → 409, plus 409 handling in `pushMemoryCreateJob` (clear dirty) like tasks have.

### 2. [Critical] First-run migration claim pushes old local data into whoever is signed in — and master's fixed seed label ids guarantee cross-user PK collisions
**File:** `lib/store/sync.ts` L446-L453
- On the first boot of the sync-aware build, everything in localStorage is claimed for the current account. Master's client seed (`lib/store/seed.ts`, deleted) used **fixed label ids** (`label_personal`, `label_work`, …) identical in every browser. After deploy: the first migrated browser inserts those PK ids globally; every other user's browser then PUTs the same ids → finding #1's crash path (pg): permanently dirty labels + a 500 on every mount for every other migrated user. This is not an adversarial edge — it's the default upgrade path.
- Secondary: on a shared browser, the previous user's tasks/memories are claimed and pushed into the *next* signed-in account (cross-account data leak), and master's client-side demo seed tasks (~10, random ids) become durable server data for every migrated user.
**Fix:** At claim time, re-mint local label ids (and remap task `labelIds`) before marking dirty — the remap machinery already exists; combined with the #1 labels fix, PK collision becomes structurally impossible. Consider excluding the known fixed seed-label ids and known master seed content, and document the shared-browser claim tradeoff explicitly.

### 3. [High] Value-level schema drift permanently and silently wedges sync (strict caps vs unbounded UI, no 4xx handling, no logging)
**Files:** `lib/domain/task-patch-schema.ts` L27-L64; `lib/store/sync.ts` L152-L167 (enqueue), L281-L291; `components/tasks/task-detail-sheet.tsx` L132-L143, L150-L158, L711-L731, L820-L833; `components/tasks/capture-dialog.tsx` L71-L84; `app/(app)/memory/page.tsx` L54-L59
The client pushes the full entity; the server validates strictly; the UI enforces none of the caps. Any single out-of-bounds field makes **every** subsequent push of that entity 400 forever: dirty never clears, replayed on every mount, no `console.warn` (a non-ok response returns `false` without logging), no user-visible signal, and reconcile keeps dirty-local — permanent silent divergence across devices. Reachable today:
- Clearing the title (`title.min(1)`) — select-all + delete then close the sheet.
- Title > 280 / `nextAction` > 280 (unbounded inputs).
- 21st subtask (`subtasks.max(20)`) or subtask title > 160.
- Label name > 24 (`EnsureBody.name.max(24)`) — label PUT 400s forever and the task→label link is silently dropped server-side.
- Capture text > 4000 (`sourceText.max(4000)`) — the task never reaches the server at all.
- Memory text > 2000; `aiError` > 2000 (run-triage stores the full error-response body).
**Fix (correctness by default):** Export the field limits from one module shared by schema and client; clamp in `taskPatchBody`/`taskCreateBody` and add `maxLength` to the inputs so an invalid entity cannot be constructed. Separately, treat 4xx as non-retryable in the push jobs: log loudly and surface a "changes aren't syncing" state instead of infinite silent replay (the `useServerSync` state already exists but `AppFrame` ignores it).

### 4. [High] Agent-brief adoption bypasses the dirty guard — concurrent edits can be reverted and then pushed as reverted
**File:** `components/tasks/task-detail-sheet.tsx` L303-L327 (`replaceTaskFromServer(data.task)` at L320)
`runTriage` guards adoption with `isTaskDirty` (commit c31b12b); the brief path does not. If an edit is pending (400 ms debounce or in-flight PATCH) when the brief response arrives, `replaceTaskFromServer` overwrites the local task with the server row lacking the edit; the still-scheduled patch job then reads `currentTask` at run time — now the reverted task — and pushes the reverted state. The edit is lost on both sides. Window = active typing while "Preparing…" completes; very plausible over a 5-10 s generation. Also, unlike triage, the brief flow never calls `waitForTask`, so a freshly captured task 404s ("Try again in a moment") instead of waiting for its create push.
**Fix:** Mirror the triage pattern: flush/`waitForTask(task.id)` before the fetch; on response, if `isTaskDirty(task.id)` apply only `{ agentBrief }` via `updateTask` (which re-pushes), else `replaceTaskFromServer`. Longer-term, `tasks.update` writing every column from a read-modify-write is the underlying clobber hazard — setting only the provided patch keys would make narrow updates non-conflicting by construction.

### 5. [High] Bypass bootstrap caches rejected promises forever; cross-instance create race poisons the instance
**File:** `lib/auth/session.ts` L94-L123
`bypassBootstraps` caches the bootstrap *promise* per repos instance with no rejection eviction. One transient DB failure — or the realistic race where two serverless instances cold-start concurrently and the loser's `users.create` hits the unique-email index (or the fixed `id: "user_local"` PK after `SIFTY_USER_EMAIL` changes) — permanently 500s every bypass request on that instance until restart. Two concurrent instances can also both pass `seedDemoWorkspaceIfEmpty`'s check-then-insert and double-seed the demo workspace.
**Fix:** Evict on rejection (`bootstrap.catch(() => bypassBootstraps.delete(repos))`) and make user creation insert-or-select (on create conflict, re-fetch by email). Note also the memoized `Session` freezes the entitlement snapshot for the process lifetime (stale `subscriptionActive` after checkout) — acceptable for a dev-only path, but worth a comment.

### 6. [Medium] Reconcile against a stale snapshot can drop or revert entities that synced during the pull
**File:** `lib/store/sync.ts` L437-L542
The server snapshot is fetched at t0; a create or edit that lands and clears dirty between t0 and `reconcile()` is then treated as clean: a new task absent from the stale snapshot is **dropped from the UI** ("deleted on another device" branch), an edited task is reverted to the stale server copy. Server state stays correct; the UI heals only on the next full reload. Window = pull latency vs immediate create push / 400 ms debounce — small but real (capture immediately on page load).
**Fix:** Suppress `clearDirty` while a pull is in flight (single module flag checked in `enqueue`), or snapshot the dirty set at fetch start and treat anything dirty at any point during the pull as dirty for that reconcile. Re-pushing an already-landed entity is harmless (idempotent LWW).

### 7. [Medium] Replay ordering: task PATCH can race the label PUT that creates the label — link silently lost
**File:** `lib/store/sync.ts` L545-L571 (`flushPending`); `lib/db/repos/pg.ts` L352-L371
`flushPending` fires label and task chains concurrently with no debounce stagger. `tasks.update` filters `labelIds` to labels the user owns; if the task PATCH commits before the label PUT, the link is dropped server-side while the PATCH succeeds and clears dirty — the association vanishes on the next reconcile. `pushLabelJob` only re-pushes referencing tasks in the remap (id-collision) case, not the plain-create case, so nothing repairs it.
**Fix:** In `flushPending`, await the label chains (`Promise.all` over `chains` for label keys) before replaying dirty tasks. Labels are few; the cost is one round-trip of ordering.

### 8. [Medium] `offlineBrief` Zod-parses derived content against LLM-output caps — 500s on modest task content
**File:** `lib/ai/agent-brief.ts` L163-L185
`context` items embed `sourceText` (≤4000) and `sourceContext` (≤8000) into `z.string().max(300)`; the fallback step embeds `nextAction`/title into `max(300)` with a prefix. Any capture longer than ~282 chars makes the offline path (`SIFTY_AI_OFFLINE=1`, CI, `?offline=1`) throw and the route 500. The deterministic template does not need model-output validation.
**Fix:** Truncate the composed strings, or build the `AgentBriefOutput` object directly without `.parse()`.

### 9. [Low] New agent-brief route returns raw `err.message` to the client
**File:** `app/api/agent-brief/route.ts` L81-L103
Copied from the pre-existing triage route pattern. Provider/SDK error text (which can include internal detail) is returned in the 500 body and rendered verbatim in the sheet; via the triage path it also lands in `aiError` and can exceed the 2000-char PATCH cap (feeds finding #3). `reportError` already captures the real error — return a fixed message. If fixed, fix the triage route in the same pass.

### 10. [Low] Shared-browser flash of the previous user's workspace before reconcile
**File:** `lib/store/sync.ts` L437-L459
The rehydrated store renders user A's tasks to user B for the duration of the `/api/auth/me` round-trip; `resetLocalWorkspace` only runs after it. Settings sign-out clears the cache, but session-expiry → different-user sign-in does not. `ledger.lastUserId` is available synchronously at boot — the shell could withhold list rendering until the identity check completes when `lastUserId` is set (the `useServerSync` state exists but is ignored by `AppFrame`).

### 11. [Low] 409 on task create clears dirty, but reconcile then deletes the "local-only" task
**File:** `lib/store/sync.ts` L274-L277, L487-L499
The comment says "task stays local-only", but clearing dirty means the next reconcile hits the "deleted on another device" branch and drops the task from the store — the captured text is destroyed. Only reachable via id collision (adversarial, or finding #2's fixed-id scenario for labels-adjacent flows), but the behavior contradicts the stated intent.
**Fix:** On 409, re-mint a fresh client id for the task (clone + delete old local row) and push the clone — converges with no data loss — or at minimum keep it dirty and stop claiming it stays local.

### Notes on items examined and intentionally not flagged
- `window.confirm` in settings-client matches the pre-existing repo pattern (task-detail-sheet on master).
- Triage route returning `err.message` pre-exists on master (only the new brief route is flagged).
- Client pages under `app/(app)/` using `"use client"` is the established repo-wide pattern.
- Delete-wins tombstone semantics, label non-deletability, once-per-mount pull, and per-entity LWW are documented design choices.
- `?offline=1` not consuming the daily cap: still gated by the sliding window + entitlement; pre-existing for triage.

## Run 2 — 2026-07-21 08:55 UTC (follow-up on fixes)

Verification performed directly: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm vitest run` 64/64, `pnpm build` clean, Playwright e2e 4/4 (one cold-server flake on first run passed unchanged on retry). Run 1 criticals re-verified with a scratch vitest file against `createMemoryRepos()`: label id squatting now mints a fresh id with the victim's label intact, and cross-tenant memory id throws `IdConflictError` while owner replay stays idempotent (both passed; scratch deleted). Pg implementations verified by code trace (insert-first `onConflictDoNothing().returning()`, name-race adoption, remint; owner re-select + typed conflict).

Fix status vs Run 1: #1 fixed and verified; #2 structurally resolved by #1 (documented migration tradeoffs accepted); #3 largely fixed (residuals: R2-2, R2-4); #4 fixed (adjacent gap R2-6); #5 partially fixed (residual R2-7); #6 fixed for the production single-mount case; #7 fixed in the success path (failure-branch residual R2-3); #8 fixed for length (min-bound residual R2-5); #9 fixed with test; #10 accepted as read-only — but the write-safety claim in that justification does not hold (R2-1); #11 fixed (interacts with #10 → R2-1).

### R2-1. Stale-account pushes can land before the account-switch reset — and the new 409-remint turns them into cross-account data copies
**File:** `lib/store/sync.ts` L137 (`let pushesEnabled = true`), L319-L326, L388-L395, L526-L550
`pushesEnabled` starts `true`, and the identity check that would reset the workspace only runs inside `pullAndReconcile`. In the accepted #10 window (expired session, different user signs in on the same browser), user B's session serves pushes of user A's cached entities: PATCH → 404 → POST create → 409 → `remintAndRepushTask`/`Memory` → A's content is durably created in B's account, and the subsequent pull adopts it. Before the #11 fix the 409 dropped the entity; now it materializes it — so "the reconcile reset still prevents any cross-account data writes" is no longer true. Window is real under cold-start asymmetry (slow `/api/auth/me`, warm task routes, 400 ms debounce edits).
**Fix:** Initialize `pushesEnabled = false`. It is already set `true` at exactly the right place — after the identity check/claim/reset in `pullAndReconcile` — so the only change is the initial value. Pre-pull pushes fail benignly (`request` returns null, entity stays dirty) and `flushPending` replays them post-identity-check. Zero UX cost; makes "no writes before identity confirmation" structural.

### R2-2. Emptying a memory's text permanently wedges that memory's sync (the task-title fix was not mirrored)
**Files:** `app/(app)/memory/page.tsx` L86-L88; `lib/store/sync.ts` L397-L403; `app/api/memories/[id]/route.ts` L11
The memory textarea allows clearing to `""` (`update(m.id, { text: e.target.value })`); `memoryBody` sends `text: clip("", 2000)` = `""`; `PatchBody.text` is `min(1)` → 400 → `reportRejection` → stays dirty → replayed and rejected on every mount forever. This is the exact finding-#3 wedge, fixed for task titles via the `"Untitled task"` fallback but missed for memories. The pull-failure banner does not cover push rejections, so it is console-only.
**Fix:** An empty memory is domain-invalid — delete it: on blur with empty trimmed text, call `remove(m.id)` (mirrors "nothing needs no row"). As the push-side safety net for already-empty legacy rows, have `pushMemoryPatchJob` treat empty text as a delete or skip-and-clear rather than sending a body the schema can never accept.

### R2-3. `awaitReferencedLabels` waits for label chains to settle but not to succeed — a failed label PUT still permanently drops the task→label link
**File:** `lib/store/sync.ts` L304-L311, L328-L354
`Promise.allSettled` resolves even when the label job failed (label still dirty). The task PATCH then proceeds, the server filters the unknown label id, the PATCH succeeds and clears the task's dirty mark. The label lands on the next mount, but nothing re-pushes the referencing task (only the remap path does), so the next reconcile replaces the clean local task with the server copy — link gone on both sides. This is finding #7's silent-vanish surviving in the failure branch (e.g. label PUT 500s while the task PATCH succeeds).
**Fix:** After awaiting the chains, return `false` from the task job if any referenced label is still dirty (`isDirty("labels", labelId)`) — the task stays dirty and replays after the label lands. Alternatively, re-push referencing tasks on every successful label push, not just the remap case.

### R2-4. `limits.ts` did not absorb the remaining hardcoded caps — the triage request can still 400 from UI-producible state
**Files:** `app/api/tasks/route.ts` L24; `app/api/triage/route.ts` L16-L19; `lib/ai/run-triage.ts` L68-L73
Three residuals of the finding-#3 class:
- `CreateBody.sourceText` and the triage route hardcode `.max(4000)`/`.max(8000)` — same values as `TASK_LIMITS` but as literals that can drift, defeating the module's stated purpose ("the strict API can never reject an entity the UI allowed").
- `runTriage` sends `current.sourceText`/`current.sourceContext` unclamped, so a legacy oversized capture 400s the triage route ("Invalid body" → `aiError`) on every retry.
- Concretely reachable today: `preferences: state.memories.filter((m) => m.pinned)` is unbounded while the route caps `preferences` at `.max(20)`. Pinning a 21st memory (no UI cap exists) makes **every** triage request 400 until something is unpinned, with only "Invalid body" as the symptom.
**Fix:** Replace the literals with `TASK_LIMITS.*` in both routes; in `runTriage`, clip the two text fields and bound the arrays at the source (e.g. `.slice(0, 20)` on pinned preferences — or better, a shared `TRIAGE_CONTEXT_LIMITS` constant used by both the route schema and the client body, so this pair can't drift either).

### R2-5. `offlineBrief` still 500s when `nextAction` is an empty string (finding #8 fixed max, not min)
**File:** `lib/ai/agent-brief.ts` L170
`task.nextAction ?? …` keeps `""` (empty string is not nullish) → step `""` → `steps` item `min(1)` → `.parse()` throws → route 500. `nextAction: ""` is UI-producible (clearing the Next action textarea stores `""`, not null) and server-storable (schema is max-only). Reachable for any subtask-less task in offline mode (dev/CI/e2e).
**Fix:** Use `task.nextAction || …`. Better: Run 1's alternative stands — construct the typed `AgentBriefOutput` object directly and drop `.parse()`; a deterministic template does not need model-output validation, and this is the second parse-conformance bug in it.

### R2-6. Brief/triage adoption resurrects a task deleted during generation (`replaceTaskFromServer` inserts when missing)
**Files:** `lib/store/store.ts` L292-L298; `components/tasks/task-detail-sheet.tsx` L325-L335; `lib/ai/run-triage.ts` L86-L92
Deleting a task clears its dirty mark (tombstone path), so when the brief/triage response arrives `isTaskDirty` is false and `replaceTaskFromServer(data.task)` re-inserts the deleted task into the store — a ghost that lingers until the next pull. Both adoption call sites guard dirtiness but not existence.
**Fix:** Make `replaceTaskFromServer` update-only (drop the insert branch). Both callers are adopt-after-generation flows where the local row existed at fetch time; the insert branch exists only to create this bug, and removing it makes the mistake unrepresentable.

### R2-7. Bypass bootstrap: changing `SIFTY_USER_EMAIL` against a Postgres store still 500s every request (finding #5's parenthetical survived)
**File:** `lib/auth/session.ts` L118-L133
The recovery path re-fetches by email, but a PK conflict on the fixed `id: "user_local"` with a *different* email finds nothing and rethrows — now uncached, so it fails on every request and never heals. The fixed id does serve memory-repos dev (stable `ledger.lastUserId` across restarts), so don't remove it — but the pg path needs the second fallback.
**Fix:** In the catch, when `getByEmail` finds nothing, retry the create without the fixed id (let `users.create` mint). Covers both conflict sources (email unique, id PK). Optionally add the Run 1-suggested comment that the memoized `Session` freezes the entitlement snapshot for the process lifetime (dev-only tradeoff).

### R2-8. `isTerminalRejection` is dead code whose comment documents the opposite of the shipped behavior
**File:** `lib/store/sync.ts` L225-L232
The function is never called, and its docstring ("let the caller clear the mark") describes the clear-dirty-on-4xx design that was explicitly rejected in favor of retry-with-clamps. Dead code is a bug per conventions; a comment asserting a nonexistent contract will mislead the next editor.
**Fix:** Delete the function and its comment. If the retry-on-4xx rationale is worth keeping, put one line of it on `reportRejection`, which is the code that actually runs.

### R2-9. Pg `memories.create` conflict fallback uses `input.id!`, which is undefined when the id was server-minted
**File:** `lib/db/repos/pg.ts` L425-L448
If `input.id` is absent (id minted inline) and the insert conflicts, the fallback runs `eq(schema.memories.id, undefined)` — Drizzle throws. Practically unreachable (fresh-mint collision), but the `!` assertion is false as documentation, and `tasks.create` directly above already does it right.
**Fix:** Mirror `tasks.create`: `const id = input.id ?? makeId("mem")` once, use `id` in both the insert values and the fallback; the assertion disappears.

### R2-10. The tenancy-critical conflict contracts fixed in #1 have no regression tests
**Files:** `tests/db/tenancy.test.ts`; `tests/sync/tasks-sync.test.ts`
The task cross-tenant 409 is covered, but the two behaviors that were verifiably broken in Run 1 — `labels.ensure` minting a fresh id instead of claiming a taken (cross-tenant) id, and `memories.create` throwing `IdConflictError` on a cross-tenant id while staying idempotent for the owner — have zero coverage. Both sit in the mandatory tenancy zone, both had concrete data-destroying failure modes, and the pg logic (three-step insert/adopt/remint) is exactly the kind of subtle code a future "simplification" regresses. Two focused tests mirroring the existing task-409 test (repo-level in `tenancy.test.ts` is enough; the memory impl mirrors pg semantics) — no broader test scaffolding needed.

## Run 3 — 2026-07-21 09:20 UTC (verification of Run-2 fixes)

Verification performed directly: `pnpm biome check` clean, `pnpm tsc --noEmit` clean, `pnpm vitest run` 66/66, `pnpm build` clean, Playwright e2e 4/4.

Fix status vs Run 2 — all ten fixes verified correct by code trace:
- **R2-1 fixed.** `pushesEnabled` initializes `false` (sync.ts L143) with the rationale documented; the only assignment to `true` is after the identity check/claim/reset in `pullAndReconcile`. Pre-identity pushes return null from `request`, stay dirty, and replay via `flushPending`. Traced the capture-then-triage side channel too: a pre-identity `/api/triage` call can run, but `applyTriageToTask` finds no server row (create was blocked) so no stale-entity write occurs.
- **R2-2 fixed.** Memory page deletes on empty blur; `pushMemoryCreateJob`/`PatchJob` skip empty-text bodies (return true). Traced the skip-and-clear consequences: an empty local-only memory is dropped by the next reconcile (domain-invalid, intended), and a memory that later gains text heals via PATCH→404→create.
- **R2-3 fixed.** `awaitReferencedLabels` returns false when a referenced label is still dirty after its chain settles; both task jobs defer (stay dirty, replay). `flushPending` enqueues label chains synchronously before task chains, so the replayed task job awaits the label replay. Acyclic (labels never await tasks).
- **R2-4 fixed.** Triage route and tasks CreateBody use `TASK_LIMITS`/`AI_CONTEXT_LIMITS`; `runTriage` clips `sourceText`/`sourceContext` and slices pinned preferences to the shared max.
- **R2-5 fixed.** `offlineBrief` is a typed literal (no `.parse()`); `?.trim() ||` handles empty `nextAction`; whitespace subtasks filtered; min-2 steps guaranteed; all composed strings fitted. A zero-length edge can no longer throw since nothing validates the literal.
- **R2-6 fixed.** `replaceTaskFromServer` is update-only (map without insert); both adopt call sites are safe for mid-generation deletes; the brief route's `task: null` (update raced a delete) is guarded at the call site.
- **R2-7 fixed.** Bypass create-failure path adopts the raced row by email, else retries create without the fixed id (covers email-unique and id-PK conflicts); rejection eviction present; a second-create conflict self-heals on the next request via the top-of-function `getByEmail`.
- **R2-8 fixed.** `isTerminalRejection` deleted; retry rationale lives on `reportRejection`.
- **R2-9 fixed.** pg `memories.create` mints the id once; the conflict fallback uses it; no non-null assertion.
- **R2-10 fixed.** Both tenancy tests present and passing (labels fresh-mint with victim intact; memories owner-idempotency + cross-tenant `IdConflictError`).

Two residual issues found in the new code:

### R3-1. `pullInFlight` suppresses `clearDirty` but not `removeTombstone` — a delete that completes mid-pull resurrects the task, locally and then durably
**Files:** `lib/store/sync.ts` L361-L369 (`pushTaskDeleteJob`), L440-L448 (`pushMemoryDeleteJob`), L176-L178 (the guarded clear), L590-L602 (reconcile)
The new guard keeps dirty marks alive while a pull is reconciling so the stale snapshot can't treat a mid-pull push as clean. But the delete jobs clear their ledger mark (`removeTombstone`) inside the job body, not in the `enqueue` completion, so the guard never applies. Sequence: pull fetches start (snapshot contains task X) → user deletes X → DELETE lands before the snapshot JSON is parsed → `removeTombstone(X)` → `reconcile` sees X in `serverTasks` with no tombstone and no dirty mark → X is re-inserted into the store. The ghost is worse than cosmetic: X is `aiStatus: "pending"` resurrectable — `resumeInterruptedTriage` or any edit triggers PATCH → 404 → `pushTaskCreateJob` → X is durably re-created server-side with no user intent. Same shape for memories. Window = delete round-trip beating the three-fetch pull parse; realistic on cold serverless with a warm delete route.
**Fix:** Gate the removal: `if (!pullInFlight) removeTombstone(...)` in both delete jobs (also in the 404 branch). A tombstone left in place is self-healing — `flushPending` replays the DELETE, gets 404, and removes it then. Structural option: move ledger-mark clearing entirely into `enqueue`'s completion (it already knows kind/id and owns the `pullInFlight` check) so no future job can clear a mark outside the guard.

### R3-2. The clamp contract's stated invariant is false for the count caps — the 21st subtask/label is accepted by the UI and silently vanishes at sync
**Files:** `lib/store/sync.ts` L243-L248 (comment), L269-L272 (slices); `components/tasks/task-detail-sheet.tsx` L834-L850 (subtask add input), L689-L702 (label add)
The `taskPatchBody` doc comment says "The inputs also enforce these limits; the clamp is the safety net" — true for every string length (`maxLength` on each input) but false for `maxSubtasks`/`maxLabels`: `SubtaskList` and `LabelEditor` accept unlimited items. The wire body slices to 20, so the 21st item renders locally, never reaches the server, and disappears on the first reconcile after the task's dirty mark clears — silent user-visible data loss with no log or signal (unlike string clips, which at least keep clipped content). Run 1 #3 flagged the 21st subtask as a wedge; the clamp fixed the wedge but left the silent drop.
**Fix:** Enforce the cap at the affordance so an over-limit entity can't be constructed: hide the add-subtask input when `task.subtasks.length >= TASK_LIMITS.maxSubtasks` (empty affordance = the calm-UI convention) and skip/disable label add at `maxLabels`. That makes the comment's invariant true; the slices remain as the legacy-data safety net.

## Run 4 — 2026-07-21 10:00 UTC (final verification of Run-3 fixes)

Verification performed directly: `pnpm biome check` clean (129 files), `pnpm tsc --noEmit` clean (confirmed `playwright.config.ts` is in the compile set), `pnpm vitest run` 66/66. Working tree clean at `8957e13`. Caller additionally reports 3 consecutive clean e2e runs and full production-path verification against real Postgres.

**R3-1 fixed — verified by adversarial trace.** Both `pushTaskDeleteJob` and `pushMemoryDeleteJob` gate tombstone removal with `if (!pullInFlight) removeTombstone(...)`; the single guarded line covers both the `res.ok` and 404 branches. Traced the full lifecycle: (a) DELETE lands mid-pull → tombstone kept → `reconcile` filters the stale snapshot's copy → `pullInFlight` flips false synchronously after `reconcile` → `flushPending` replays the DELETE from `ledger.deleted.*` → 404 → tombstone removed (idempotent `removeTombstone` handles double-replay). (b) The replay's `pushNow` transiently marks the deleted id dirty; `flushPending`'s dirty-tasks loop clears it via the not-in-store branch, and the id never reaches a PATCH job. (c) A replayed 404 landing inside a *second* mount's pull re-keeps the tombstone and self-heals on that mount's own `flushPending` — converges, never resurrects. (d) DELETE failure (5xx/network) keeps the tombstone for next-mount replay. The resurrect-then-durably-recreate path from Run 3 is closed.

**R3-2 fixed — verified.** `SubtaskList` renders the add input only when `subtasks.length < TASK_LIMITS.maxSubtasks`; `LabelEditor` computes `atCap` from `task.labelIds.length >= TASK_LIMITS.maxLabels`, hides the "Add label" trigger (`: atCap ? null :`), and guards `add()` (covers popover picks and Enter/blur of an already-open input). Checked for bypassing entry points: `addSubtask` and task-label attachment have no other UI callers; triage merges are schema-bounded (≤3 labels, ≤5 subtasks) and replace wholesale, so they cannot push counts past the cap. The `taskPatchBody` comment now correctly states "maxLength, capped add affordances" with the slices as the legacy-data net. Examined and not flagged: an already-open label input surviving an external transition to `atCap` mid-typing becomes inert until Escape — reachable only if adoption *raised* labelIds to ≥20 while typing, which triage (≤3, wholesale replace) and brief (no label change) cannot do.

**Playwright `RATELIMIT_TRIAGE_PER_MIN` change verified.** The `env` block spreads `process.env` (required — Playwright replaces the environment when `env` is provided) and the `?? "200"` escape lets a smoke environment lower the cap to exercise the 429 path. CI's e2e job has no `PLAYWRIGHT_BASE_URL`, so the managed webServer gets the cap; the persistent `ai_runs` window shares `TRIAGE_POLICY.capacity`, so both limiter layers are covered; the CI bypass user resolves to the creator (default email = `CREATOR_EMAIL`) with an unlimited daily cap, so no third-layer starvation. The burst test self-skips at cap 200 with an instructive skip message; limiter semantics (bucket 429 + Retry-After, cross-instance persistent window) are covered by `tests/ratelimit/triage.test.ts`. Examined and not flagged: `reuseExistingServer` locally bypasses the env block for a manually started dev server — inherent to reusing external servers and pre-existing behavior, and the `PLAYWRIGHT_BASE_URL` path is unchanged from master.

No issues found. All findings from Runs 1–3 are fixed or explicitly accepted with documented rationale; the branch is clear from this reviewer's perspective.
