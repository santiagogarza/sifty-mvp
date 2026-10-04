---
name: screen-recording-proof
description: Always show a screen recording after building a new feature or fixing a bug to prove it works. Use whenever a task adds, changes, or fixes user-visible behavior (UI, CLI, API, or tests) and the work is ready to be reported. The recording must capture the real change running end-to-end, be saved as an artifact, and be embedded in the final response.
---

# Screen recording proof

Always show a screen recording after building a new feature or fixing a bug to prove it works. A description of what "should" happen is not proof. The deliverable is not done until the recording is embedded in the final response.

## When this applies

- A new feature was built.
- A bug was fixed.
- Existing behavior was changed in a way a user, operator, or developer would notice.

Skip only for pure refactors with no observable change, docs-only edits, or when the user explicitly says `/no-test` or asks for no recording.

## Workflow

```
Recording checklist:
- [ ] Set up the environment and navigate to the exact screen or command that exercises the change
- [ ] For bug fixes: capture the broken behavior first if it can be reproduced cheaply (checkout the pre-fix state or toggle the fix off)
- [ ] Start recording with RecordScreen mode=START_RECORDING
- [ ] Exercise the change end-to-end via the computerUse subagent (GUI) or a tmux terminal session (CLI/API/tests)
- [ ] Stop recording immediately after the demonstration ends
- [ ] Success: RecordScreen mode=SAVE_RECORDING with a descriptive snake_case filename
- [ ] Failure: RecordScreen mode=DISCARD_RECORDING, fix the problem, retry
- [ ] Review the saved video with the videoReview subagent before referencing it
- [ ] Embed it in the final response: <video src="/opt/cursor/artifacts/<name>.mp4" controls></video>
```

### GUI changes

1. Use the `computerUse` subagent to open the app and land on the relevant page before recording starts.
2. Start the recording.
3. Give the `computerUse` subagent precise step-by-step instructions covering the full user flow for the feature or the exact reproduction steps for the bug.
4. Stop and save as soon as the subagent returns.

### Non-GUI changes (CLI, API, backend, tests)

Record the terminal. Open a tmux session, start the recording, then run the command, request, or test suite that demonstrates the behavior. Keep the terminal font readable and the window focused on the output. If no screen recorder is available, fall back to a saved log under `/opt/cursor/artifacts/` and say explicitly that a video could not be produced and why.

### Bug fixes

Prefer a before/after pair: one short recording of the bug reproducing, one of the fix. If reproducing the pre-fix state is expensive, record only the fixed behavior and state what the bug was in the response text.

## Rules

- Start the recording right before the demonstration, not during setup. Split multiple scenarios into separate recordings rather than one long video.
- Never save a recording of a failed or partial demonstration. Discard, fix, and re-record.
- Never fabricate a toy or contrived scenario. The recording must exercise the actual change in the actual app.
- The filename must describe the entire video, e.g. `login_redirect_fix_after.mp4`, `export_csv_feature_end_to_end.mp4`.
- Artifacts are immutable; use a new filename for each re-recording.
- One recording that proves the change is better than five that show setup. Add screenshots only when they show something the video does not.

## Final response

Place the `<video>` tag directly under a one-line statement of what the recording shows. If a recording was expected but not produced, state the blocker in one sentence instead of omitting it silently.
