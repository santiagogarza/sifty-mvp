/**
 * Prompt version bump policy (applies to every prompt in `lib/ai/`):
 *
 * Each prompt carries a `promptVersion` ("<stage>.v<n>": `enrich.v1`,
 * `triage.v2`, `brief.v1`, …) that is written to `ai_runs.prompt_version`
 * for every call. Any change to what the model sees or must return — the
 * system prompt, the user prompt template, the output schema (including
 * field descriptions and bounds), or the temperature — bumps that version.
 * Wording nits are not exempt: an old `ai_runs` row must always be
 * interpretable as "produced by exactly this prompt".
 *
 * A bump is always accompanied by an eval run:
 *
 *   1. Edit the prompt and bump its version in the same change.
 *   2. `SIFTY_AI_OFFLINE=1 pnpm eval:update` — records the new prompt
 *      fingerprint in `evals/baselines/prompt-fingerprints.json` (the CI eval
 *      fails on a prompt whose fingerprint moved without a bump, or a bumped
 *      version without a recorded fingerprint) and re-records the offline
 *      rubric baseline.
 *   3. Run the golden set against real models before merging:
 *      `AI_TRANSPORT=gateway AI_GATEWAY_API_KEY=… pnpm eval` locally, or
 *      the "Evals (real models)" workflow by hand. Paste the pass-rate
 *      table from `evals/.results/online-gateway-summary.md` into the PR.
 *   4. Commit the baselines with the prompt change. Never edit a baseline
 *      file by hand.
 *
 * Old versions stay in the fingerprint file as history. See `evals/README.md`.
 *
 * ---------------------------------------------------------------------------
 *
 * Single-shot triage prompt (legacy path kept for the eval harness and
 * `?offline=1`; the pipeline prompts live in `lib/ai/sift/stages.ts`).
 *
 * Constraints:
 * - Be brief in `title` and `nextAction`. Verbs first.
 * - `dueHint` only when the input contains a real signal ("by Friday",
 *   "before the demo Tuesday", a date). Don't invent deadlines.
 * - Confidence below 0.55 should produce a single clarifyingQuestion.
 */
export const TRIAGE_SYSTEM_PROMPT = `You triage tasks for an AI productivity app called Sifty.

Style:
- Be calm and concise. Verbs first. No emoji. No hype.
- Default to brevity. A great title is 3-7 words.
- Never invent dates, people, or context not present in the input.

For each task, infer:
- A clean title and (if helpful) a short description.
- A single GTD-style "next physical action" — concrete, doable in one sitting.
- Urgency and importance in [0,1]. Reserve >= 0.85 for clear emergencies or
  high-stakes commitments. Casual asks should sit around 0.4.
- Effort: quick (<10 min), small (<30 min), medium (1–3 hr), deep (multi-session).
- A delegation candidate. Most personal tasks are "self". Tag "ai" only when the
  task is well-defined and verifiable. Tag "person" when handoff to a human is
  clearly the right move. Use "unsure" rather than guessing.
- Up to 3 short labels and up to 5 subtasks (only when warranted).
- A confidence score. If below 0.55, set one clarifyingQuestion the user can
  answer in under 10 seconds. Otherwise leave clarifyingQuestion null.

Output must conform to the supplied JSON schema exactly.`;

export function buildTriageUserPrompt(args: {
  sourceText: string;
  sourceContext: string | null;
  todayIso: string;
  recentLabels: string[];
  preferences: string[];
}): string {
  return [
    `Today is ${args.todayIso}.`,
    args.recentLabels.length
      ? `User's existing labels (prefer reusing): ${args.recentLabels.join(", ")}.`
      : null,
    args.preferences.length ? `User preferences:\n- ${args.preferences.join("\n- ")}` : null,
    "",
    "Task:",
    args.sourceText,
    args.sourceContext ? `\nAdditional context:\n${args.sourceContext}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
