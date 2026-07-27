---
name: good-ui-ux-design
description: Behavioral-psychology and UX design expertise for building and reviewing interfaces. Applies cognitive biases, friction analysis, the B.I.A.S. framework, the Hooked Model, Peak-End journey design, and Dieter Rams' quality bar. Use when designing or building any UI (pages, components, flows, onboarding, signup, checkout, pricing, landing pages, empty/error states), when reviewing or critiquing an existing page or flow, when writing microcopy, or when the user mentions UX review, conversion, retention, activation, friction, dark patterns, or making a product experience better.
---

# Good UI/UX Design

Ground every interface decision in how humans actually think, decide, and remember. Name the specific principle behind each choice — never "make it cleaner", always "reduce Hick's Law load by moving secondary actions into an overflow menu".

## How to apply this skill

Match the depth to the task:

- **Building or changing UI** (most common): weave the checklists below into the work directly. Pick the 2–4 most relevant principles, apply them, and mention them briefly when explaining the result. No ceremony, no separate brief.
- **Designing a significant new flow** (onboarding, checkout, pricing, a whole page): produce a short design brief (template below) before implementing, so the reasoning is visible and correctable.
- **Reviewing an existing page or flow**: produce a UX audit (template below) with prioritized, principle-backed fixes.
- **Answering a question about a principle**: answer directly; read the relevant reference file if precision matters.

## Core mental model: the 4-step decision cycle

Every interaction passes through four mental stages. Design for all four:

1. **Information (filtering)** — Users ignore most of what they see. Cut noise, use visual hierarchy, contrast, progressive disclosure. Key principles: Hick's Law, Cognitive Load, Fitts's Law, Banner Blindness.
2. **Meaning (interpreting)** — Users fill gaps with assumptions. Leverage Social Proof, Mental Models, Familiarity, Anchoring, Reciprocity, the Aha Moment. Make value obvious.
3. **Time (acting)** — Users take shortcuts. Use smart Defaults, few decisions per screen, small steps, Loss Aversion framing. Respect Reactance — never force.
4. **Memory (storing)** — Users remember peaks and endings. Apply Peak-End Rule, Delighters, Zeigarnik Effect, Chunking, trust-building exit points.

For the full catalog of 106 biases organized by these stages, read [references/cognitive-biases.md](references/cognitive-biases.md).

## Per-screen check: B.I.A.S.

For any screen or component, ask:

- **Block** — Does it pass brain filters? Noticeable, not ad-like, not intimidating, well-timed?
- **Interpret** — Minimal cognitive load, familiar patterns, clear benefits, good comparison anchors?
- **Act** — Few decisions, smart defaults, small steps, options reduced, one obvious primary action?
- **Store** — Clear feedback, reassurance, signs of care, a moment of delight?

## Per-action check: B = Motivation × Ability × Prompt (Fogg)

A behavior happens only when motivation, ability, and a prompt converge. If a feature isn't working, diagnose which of the three is failing — and **increase ability before motivation**: making an action easier is more reliable than making users want it more. The six ability levers: time, money, physical effort, brain cycles, social deviance, non-routine.

## Friction: remove it from value, add it before regret

Friction exists at three layers — audit all three (details and scoring rubric in [references/zero-friction-design.md](references/zero-friction-design.md)):

| Layer | Looks like | Fix |
|-------|-----------|-----|
| **Interaction** (surface) | Extra taps, small targets, slow loads, needless form fields | Count taps and reduce; pre-fill; Fitts's Law; instant feedback |
| **Cognitive** (mental) | Unclear labels, too many choices, jargon, unpredictable outcomes | One primary action per screen; progressive disclosure; plain language; feedforward |
| **Emotional** (deepest) | Fear of commitment, trust anxiety, embarrassment, overwhelm | Make things reversible; reduce perceived commitment; social proof; security signals at data entry |

**The rule**: remove friction from the path to value; add friction only before the path to regret (irreversible deletes, large purchases, public posts).

## Journey design: Peak-End

For any multi-screen flow:

- Engineer the **peak** (best moment) deliberately — don't leave it to chance.
- Find and fill the **pit** (worst moment); fixing the pit usually beats elevating the peak.
- **End on a high note** — a mediocre experience with a great ending beats a good one with a bad ending.
- Mark transitions and milestones proportionally to their importance.
- Use waits: Labor Illusion ("Searching 1,247 options for you…") turns dead time into perceived value.

## Habit loops: the Hooked Model

When a feature needs repeat engagement, verify all four phases — Trigger → Action → Variable Reward → Investment. Broken-hook symptoms: users need constant emails/ads to return (no internal trigger), drop-off at the action (friction), try-once-and-leave (reward not variable), no post-onboarding engagement (no investment loop). Full breakdown with reward types (Tribe / Hunt / Self) in [references/hooked-model.md](references/hooked-model.md).

## Quality bar: Dieter Rams

"Less, but better." Before shipping any UI, check the ones that fail most often:

- **Useful** — every element earns its place; if removing it changes nothing, remove it.
- **Understandable** — a first-time user completes the core task with no tutorial. Copy is design.
- **Unobtrusive** — the user's content is the star, not the chrome.
- **Honest** — no fake scarcity, no misleading progress bars, no disguised ads.
- **Thorough** — empty, error, loading, and overflow states designed; accessible; responsive at every breakpoint.
- **As little as possible** — when in doubt, remove.

All 10 principles with design tests and a scoring checklist: [references/dieter-rams-10-principles.md](references/dieter-rams-10-principles.md).

## Ethical gate (non-negotiable)

Never apply dark patterns or manufactured urgency, even if requested — offer an honest alternative instead. Before shipping anything that shapes user behavior:

- **Regret Test** — if the user were in the room watching you design this, would you say the same things?
- **Black Mirror Test** — what does "too much" of this feature look like? Who gets hurt?
- Real scarcity only; user-favorable defaults; genuine exit points; user control over what they receive.

## Top principles quick reference

| Principle | One-liner | Where it matters most |
|-----------|-----------|----------------------|
| Hick's Law | More options = harder decisions | Navigation, pricing, settings |
| Cognitive Load | Mental effort to complete a task | Forms, onboarding, dashboards |
| Social Proof | People follow what others do | Landing, signup, checkout |
| Loss Aversion | Losses hurt more than equivalent gains | Churn, upgrade flows |
| Anchoring | First info shapes all comparisons | Pricing, feature comparison |
| Peak-End Rule | Judged by peak + ending | Journeys, offboarding |
| Default Bias | People stick with what's set | Settings, opt-ins |
| Progressive Disclosure | Reveal complexity later | Onboarding, discovery |
| Goal Gradient | Motivation rises near the goal | Progress bars, multi-step flows |
| Reactance | Forced behavior breeds resistance | Pop-ups, required actions |
| Zeigarnik Effect | Incomplete tasks stick in memory | Re-engagement, saves |
| Aha Moment | First realization of value | Onboarding, activation |
| Labor Illusion | Visible effort = perceived value | Loading, search results |
| Feedforward | Preview outcomes before commit | Destructive or bulk actions |
| Aesthetic-Usability | Beautiful is perceived as usable | First impressions, trust |
| Recognition over Recall | Show options, don't demand memory | Pickers, search, navigation |

## Design brief template

For significant new flows, before implementing:

```
## Design brief: <feature>

Target behavior: <the single action this screen exists for>
User state at arrival: <what they just did, know, fear>
M / A / P: <which is weakest and why>

Principles applied:
1. <Principle> — <how>
2. <Principle> — <how>
3. <Principle> — <how>

Journey: <peak, pit, ending — if multi-screen>
Ethical gate: <pass, or what changed to pass>

Layout & copy:
- Primary CTA: <exact copy + why>
- Supporting elements: <list>
- Empty / error / success states: <copy>
- Deliberately omitted: <what + why>
```

## UX audit template

When reviewing an existing page or flow:

```
## UX audit: <page/flow>

Verdict: Ship as-is | Ship with minor fixes | Needs revision

What's working:
- <item + principle it exemplifies>

Critical fixes:
1. <Issue> → <specific fix> → <principle>

Suggested improvements:
1. <Issue> → <specific fix> → <principle>

Friction hotspots: <step + layer + fix, worst first>
Ethical flags: <list or "none">
```

For a full checkbox-level walkthrough (B.I.A.S. details, journey mapping, ethical tests), read [references/ux-audit-checklist.md](references/ux-audit-checklist.md).

## Reference files

Read only what the task needs:

| File | When to read |
|------|-------------|
| [references/cognitive-biases.md](references/cognitive-biases.md) | Choosing precise principles for a brief or audit; all 106 biases by decision stage |
| [references/zero-friction-design.md](references/zero-friction-design.md) | Friction audits; scoring rubric, proven zero-friction patterns, AI-product friction traps |
| [references/hooked-model.md](references/hooked-model.md) | Retention, engagement, habit loops; Trigger → Action → Variable Reward → Investment in depth |
| [references/dieter-rams-10-principles.md](references/dieter-rams-10-principles.md) | Holistic quality review; all 10 principles with design tests |
| [references/product-classification.md](references/product-classification.md) | Strategy: Painkiller / Vitamin / Gummy Vitamin, and how to make a vitamin irresistible |
| [references/ux-audit-checklist.md](references/ux-audit-checklist.md) | Full structured audit: empathy questions, B.I.A.S. checkboxes, journey review, ethical tests |
