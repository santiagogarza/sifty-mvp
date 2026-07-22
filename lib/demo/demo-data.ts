import type { LabelTone, Memory, Subtask, Task } from "@/lib/domain/types";
import { id } from "@/lib/utils/ids";

/**
 * Demo workspace content, seeded when `SIFTY_DEMO_SEED=1`.
 *
 * Written to read like a real week, not lorem ipsum: every view (Today,
 * Focus, Inbox, Waiting, Someday, Memory) has content, and every AI-derived
 * field is populated so the product demos at full fidelity — rationale,
 * confidence, subtasks, labels, a clarifying question, and one prepared
 * agent brief.
 */

export const DEFAULT_LABELS: Array<{ name: string; tone: LabelTone }> = [
  { name: "Personal", tone: "sand" },
  { name: "Work", tone: "neutral" },
  { name: "Cursor", tone: "ember" },
  { name: "Writing", tone: "mist" },
  { name: "Admin", tone: "neutral" },
  { name: "Errand", tone: "sage" },
];

export interface DemoTask {
  sourceText: string;
  sourceContext: string | null;
  createdDaysAgo: number;
  labelNames: string[];
  patch: {
    title: string;
    description: string | null;
    nextAction: string | null;
    lifecycle: Task["lifecycle"];
    aiStatus: Task["aiStatus"];
    urgency: number;
    importance: number;
    effort: Task["effort"];
    due: string | null;
    delegationCandidate: Task["delegationCandidate"];
    assigneeName?: string | null;
    confidence: number;
    clarifyingQuestion: string | null;
    rationale: string | null;
    agentBrief: string | null;
    subtasks: Subtask[];
  };
}

export function demoMemories(): Array<Omit<Memory, "id">> {
  const now = new Date().toISOString();
  return [
    {
      text: "Default work hours are 9am–6pm. Avoid scheduling deep work after 4pm.",
      kind: "preference",
      pinned: true,
      createdAt: now,
    },
    {
      text: "Prefer small, shippable steps over big-bang launches.",
      kind: "preference",
      pinned: true,
      createdAt: now,
    },
    {
      text: "I split projects between Cursor work and personal writing.",
      kind: "fact",
      pinned: false,
      createdAt: now,
    },
    {
      text: "Thursday mornings are blocked for customer calls.",
      kind: "context",
      pinned: false,
      createdAt: now,
    },
  ];
}

export function demoTasks(): DemoTask[] {
  const subtask = (title: string, order: number, done = false): Subtask => ({
    id: id("st"),
    title,
    done,
    order,
  });

  return [
    // ---- Today / Focus: urgent + important ----
    {
      sourceText: "Draft the launch announcement for the Sifty preview by Friday",
      sourceContext: "Audience: existing beta list plus the Cursor community post.",
      createdDaysAgo: 1,
      labelNames: ["Work", "Writing"],
      patch: {
        title: "Draft launch announcement for Sifty preview",
        description: "Audience: existing beta list plus the Cursor community post.",
        nextAction: "Write a one-paragraph outline of audience, message, and proof points.",
        lifecycle: "active",
        aiStatus: "ready",
        urgency: 0.78,
        importance: 0.88,
        effort: "medium",
        due: isoDaysFromNow(2),
        delegationCandidate: "self",
        confidence: 0.84,
        clarifyingQuestion: null,
        rationale:
          "Deadline is explicit (Friday) and launch communication is high-leverage. Sized medium: one focused writing session plus a review pass.",
        agentBrief: null,
        subtasks: [
          subtask("List the 3 core proof points", 0),
          subtask("Write the outline", 1),
          subtask("Draft and read aloud once", 2),
        ],
      },
    },
    {
      sourceText: "Send the investor update before the board sync on Thursday",
      sourceContext: null,
      createdDaysAgo: 1,
      labelNames: ["Work", "Admin"],
      patch: {
        title: "Send investor update before Thursday board sync",
        description: null,
        nextAction: "Pull the three headline metrics into the update template.",
        lifecycle: "active",
        aiStatus: "ready",
        urgency: 0.85,
        importance: 0.8,
        effort: "small",
        due: isoDaysFromNow(1),
        delegationCandidate: "self",
        confidence: 0.87,
        clarifyingQuestion: null,
        rationale:
          "Matched an importance phrase (investor, board) and a hard date. Small effort: the template exists, only metrics and narrative change.",
        agentBrief: null,
        subtasks: [],
      },
    },
    {
      sourceText: "Fix the flaky capture shortcut on iOS Safari — users report double dialogs",
      sourceContext: "Repro: fast double-tap on the capture FAB. Likely a focus/timing issue.",
      createdDaysAgo: 2,
      labelNames: ["Cursor", "Work"],
      patch: {
        title: "Fix flaky capture shortcut on iOS Safari",
        description: "Repro: fast double-tap on the capture FAB. Likely a focus/timing issue.",
        nextAction: "Reproduce with Safari remote debugging and capture the event order.",
        lifecycle: "active",
        aiStatus: "ready",
        urgency: 0.7,
        importance: 0.75,
        effort: "medium",
        due: null,
        delegationCandidate: "ai",
        confidence: 0.74,
        clarifyingQuestion: null,
        rationale:
          "User-facing bug in the core capture loop — importance high. AI-suitable: bounded repro plus a code-level fix an agent can attempt.",
        agentBrief: null,
        subtasks: [
          subtask("Reproduce and log event order", 0),
          subtask("Guard against double-open in the dialog state", 1),
          subtask("Verify on-device", 2),
        ],
      },
    },
    // ---- Schedule: important, not urgent ----
    {
      sourceText: "Investigate streaming SSR options for the dashboard",
      sourceContext:
        "Some pages still hydrate slowly on iOS Safari. Want to scope what changes when we move to streaming.",
      createdDaysAgo: 4,
      labelNames: ["Cursor", "Work"],
      patch: {
        title: "Investigate streaming SSR options for the dashboard",
        description:
          "Some pages still hydrate slowly on iOS Safari. Want to scope what changes when we move to streaming.",
        nextAction: "Block 30 min and write a one-paragraph problem statement.",
        lifecycle: "active",
        aiStatus: "ready",
        urgency: 0.45,
        importance: 0.7,
        effort: "deep",
        due: null,
        delegationCandidate: "ai",
        confidence: 0.76,
        clarifyingQuestion: null,
        rationale:
          "Deep-work research with no deadline — schedule it. Strong agent candidate: the investigation is self-contained and produces a written artifact.",
        agentBrief: [
          "## Objective",
          "Evaluate streaming SSR options for the Sifty dashboard and recommend one approach.",
          "",
          "## Context",
          "- Next.js 15 App Router; slow hydration reported on iOS Safari.",
          "- Today/Focus pages render list-heavy client components.",
          "- We care about calm perceived performance, not benchmark wins.",
          "",
          "## Steps",
          "1. Profile current hydration cost on a mid-tier iPhone.",
          "2. Compare: streaming with Suspense boundaries vs. partial prerendering.",
          "3. Prototype streaming on the Today view behind a flag.",
          "4. Write a one-page recommendation with the migration cost.",
          "",
          "## Success criteria",
          "- A clear go/no-go recommendation with measured numbers.",
          "- No regression to keyboard-first interactions.",
        ].join("\n"),
        subtasks: [
          subtask("Read current Next docs on streaming", 0, true),
          subtask("Write a one-pager comparing options", 1),
        ],
      },
    },
    {
      sourceText: "Plan the Q3 personal writing schedule — two essays and the newsletter revamp",
      sourceContext: null,
      createdDaysAgo: 5,
      labelNames: ["Personal", "Writing"],
      patch: {
        title: "Plan Q3 writing schedule",
        description: "Two essays and the newsletter revamp.",
        nextAction: "List candidate essay topics and pick two.",
        lifecycle: "active",
        aiStatus: "ready",
        urgency: 0.3,
        importance: 0.65,
        effort: "small",
        due: null,
        delegationCandidate: "self",
        confidence: 0.72,
        clarifyingQuestion: null,
        rationale:
          "Important but not time-bound — classic schedule quadrant. Kept small: the planning session is 30 minutes, the writing is separate tasks.",
        agentBrief: null,
        subtasks: [],
      },
    },
    // ---- Inbox: newly captured ----
    {
      sourceText: "Look into the weird spike in webhook retries from Stripe last night",
      sourceContext: null,
      createdDaysAgo: 0,
      labelNames: ["Work", "Admin"],
      patch: {
        title: "Investigate Stripe webhook retry spike",
        description: null,
        nextAction: "Check the webhook delivery log for the affected window.",
        lifecycle: "inbox",
        aiStatus: "ready",
        urgency: 0.6,
        importance: 0.55,
        effort: "small",
        due: null,
        delegationCandidate: "self",
        confidence: 0.68,
        clarifyingQuestion: null,
        rationale:
          "Operational anomaly — worth a look soon, but retries succeeded so nothing is on fire. Left in inbox for a decision after the log check.",
        agentBrief: null,
        subtasks: [],
      },
    },
    {
      sourceText: "Team offsite",
      sourceContext: null,
      createdDaysAgo: 0,
      labelNames: ["Work"],
      patch: {
        title: "Team offsite",
        description: null,
        nextAction: null,
        lifecycle: "inbox",
        aiStatus: "ready",
        urgency: 0.4,
        importance: 0.5,
        effort: "small",
        due: null,
        delegationCandidate: "unsure",
        confidence: 0.38,
        clarifyingQuestion: "Is this about planning the offsite, or preparing something for it?",
        rationale:
          "Two words with no verb — the intent is ambiguous, so confidence is low and a single clarifying question would unblock triage.",
        agentBrief: null,
        subtasks: [],
      },
    },
    // ---- Waiting ----
    {
      sourceText: "Reply from the contractor about the bathroom estimate",
      sourceContext: "Asked for an itemized quote on Monday.",
      createdDaysAgo: 3,
      labelNames: ["Personal", "Admin"],
      patch: {
        title: "Contractor bathroom estimate",
        description: "Asked for an itemized quote on Monday.",
        nextAction: "Nudge if no reply by Friday.",
        lifecycle: "waiting",
        aiStatus: "ready",
        urgency: 0.35,
        importance: 0.45,
        effort: "quick",
        due: isoDaysFromNow(3),
        delegationCandidate: "person",
        assigneeName: "Contractor",
        confidence: 0.81,
        clarifyingQuestion: null,
        rationale:
          "The ball is in the contractor's court — parked in Waiting with a follow-up date instead of cluttering Today.",
        agentBrief: null,
        subtasks: [],
      },
    },
    {
      sourceText: "Legal review of the updated privacy policy before we can ship EU sign-ups",
      sourceContext: null,
      createdDaysAgo: 6,
      labelNames: ["Work", "Admin"],
      patch: {
        title: "Legal review of updated privacy policy",
        description: "Blocks EU sign-ups.",
        nextAction: "Check in with counsel on the review timeline.",
        lifecycle: "waiting",
        aiStatus: "ready",
        urgency: 0.5,
        importance: 0.7,
        effort: "quick",
        due: isoDaysFromNow(5),
        delegationCandidate: "person",
        assigneeName: "Counsel",
        confidence: 0.79,
        clarifyingQuestion: null,
        rationale:
          "Blocked on an external reviewer. Importance is high (ship blocker) so it carries a follow-up date rather than waiting passively.",
        agentBrief: null,
        subtasks: [],
      },
    },
    // ---- Someday ----
    {
      sourceText: "Read the new Things 3 review and note what feels different",
      sourceContext: null,
      createdDaysAgo: 8,
      labelNames: ["Personal", "Writing"],
      patch: {
        title: "Read the Things 3 review and note what feels different",
        description: null,
        nextAction: "Save the article to the reading queue.",
        lifecycle: "someday",
        aiStatus: "ready",
        urgency: 0.15,
        importance: 0.4,
        effort: "small",
        due: null,
        delegationCandidate: "self",
        confidence: 0.7,
        clarifyingQuestion: null,
        rationale: "Inspiration reading with no deadline — someday list keeps it out of the way.",
        agentBrief: null,
        subtasks: [],
      },
    },
    {
      sourceText: "Redesign the personal site around the essays instead of the portfolio",
      sourceContext: null,
      createdDaysAgo: 10,
      labelNames: ["Personal", "Writing"],
      patch: {
        title: "Redesign personal site around essays",
        description: null,
        nextAction: "Sketch the new information architecture on paper.",
        lifecycle: "someday",
        aiStatus: "ready",
        urgency: 0.1,
        importance: 0.5,
        effort: "deep",
        due: null,
        delegationCandidate: "ai",
        confidence: 0.66,
        clarifyingQuestion: null,
        rationale:
          "A meaningful project with zero urgency. Deep effort and AI-suitable for a first structural draft when it's picked up.",
        agentBrief: null,
        subtasks: [],
      },
    },
    // ---- Done ----
    {
      sourceText: "Renew passport before the October trip",
      sourceContext: null,
      createdDaysAgo: 12,
      labelNames: ["Personal", "Errand"],
      patch: {
        title: "Renew passport before the October trip",
        description: null,
        nextAction: "Book the renewal appointment.",
        lifecycle: "done",
        aiStatus: "ready",
        urgency: 0.6,
        importance: 0.7,
        effort: "small",
        due: null,
        delegationCandidate: "self",
        confidence: 0.85,
        clarifyingQuestion: null,
        rationale: "Hard external deadline (trip) drove urgency while it was open.",
        agentBrief: null,
        subtasks: [subtask("Book appointment", 0, true), subtask("Gather documents", 1, true)],
      },
    },
    {
      sourceText: "Ship the onboarding empty-state fix",
      sourceContext: "New users saw a blank Today view before their first capture.",
      createdDaysAgo: 9,
      labelNames: ["Cursor", "Work"],
      patch: {
        title: "Ship onboarding empty-state fix",
        description: "New users saw a blank Today view before their first capture.",
        nextAction: null,
        lifecycle: "done",
        aiStatus: "ready",
        urgency: 0.65,
        importance: 0.6,
        effort: "quick",
        due: null,
        delegationCandidate: "self",
        confidence: 0.88,
        clarifyingQuestion: null,
        rationale: "First-run experience bug — quick fix, shipped same day.",
        agentBrief: null,
        subtasks: [],
      },
    },
  ];
}

export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
