import { isoDaysFromNow } from "@/lib/demo/demo-data";
import type { Subtask, Task } from "@/lib/domain/types";
import { id } from "@/lib/utils/ids";

/**
 * First-run examples for a brand-new account (no demo flag involved).
 *
 * Three tasks, already sifted, that show what Sifty does to a capture —
 * a clear title, the next step, priority, effort, labels, subtasks, and a
 * visible rationale — including one deliberately ambiguous capture so the
 * "Sifty asks" path is seen before it happens to the user's own task. Each
 * carries the `Example` label so they are recognizable and removable.
 */

export const EXAMPLE_LABEL_NAME = "Example";

export interface StarterTask {
  sourceText: string;
  sourceContext: string | null;
  labelNames: string[];
  patch: {
    title: string;
    description: string | null;
    nextAction: string | null;
    lifecycle: Task["lifecycle"];
    aiStatus: Task["aiStatus"];
    aiAttempts: number;
    urgency: number;
    importance: number;
    effort: Task["effort"];
    due: string | null;
    delegationCandidate: Task["delegationCandidate"];
    confidence: number;
    clarifyingQuestion: string | null;
    rationale: string | null;
    subtasks: Subtask[];
  };
}

export function starterTasks(): StarterTask[] {
  const subtask = (title: string, order: number): Subtask => ({
    id: id("st"),
    title,
    done: false,
    order,
  });

  return [
    {
      sourceText: "reply to dana about the venue deposit before friday, she needs a yes/no",
      sourceContext: null,
      labelNames: [EXAMPLE_LABEL_NAME, "Admin"],
      patch: {
        title: "Reply to Dana about the venue deposit",
        description: "She needs a yes/no before Friday.",
        nextAction: "Check the budget line, then send Dana a one-line answer.",
        lifecycle: "active",
        aiStatus: "ready",
        aiAttempts: 1,
        urgency: 0.8,
        importance: 0.7,
        effort: "quick",
        // Two days out, never "today": the seed runs on the server, whose
        // calendar day can differ from the user's. Urgency × importance
        // (do_now) is what puts this one in Today, not the date.
        due: isoDaysFromNow(2),
        delegationCandidate: "self",
        confidence: 0.86,
        clarifyingQuestion: null,
        rationale:
          "Explicit deadline (Friday) and someone is blocked on the answer, so it is urgent and important. Quick: one decision and one short reply.",
        subtasks: [],
      },
    },
    {
      sourceText: "plan the q4 reading list — three books, one per month, mix fiction and work",
      sourceContext: null,
      labelNames: [EXAMPLE_LABEL_NAME, "Personal"],
      patch: {
        title: "Plan the Q4 reading list",
        description: "Three books, one per month; mix fiction and work.",
        nextAction: "Write down six candidates, then pick three.",
        lifecycle: "inbox",
        aiStatus: "ready",
        aiAttempts: 1,
        urgency: 0.3,
        importance: 0.6,
        effort: "small",
        due: null,
        delegationCandidate: "self",
        confidence: 0.79,
        clarifyingQuestion: null,
        rationale:
          "Important to you but not time-bound — a schedule-it task, not a today task. Broken into the three steps the capture already implies.",
        subtasks: [
          subtask("List six candidates", 0),
          subtask("Pick one per month", 1),
          subtask("Order or reserve the first one", 2),
        ],
      },
    },
    {
      sourceText: "dentist",
      sourceContext: null,
      labelNames: [EXAMPLE_LABEL_NAME, "Personal"],
      patch: {
        title: "Dentist",
        description: null,
        nextAction: null,
        lifecycle: "inbox",
        aiStatus: "ready",
        aiAttempts: 1,
        urgency: 0.4,
        importance: 0.5,
        effort: "quick",
        due: null,
        delegationCandidate: "unsure",
        confidence: 0.42,
        clarifyingQuestion: "Book an appointment, or prepare for one that's already booked?",
        rationale:
          "One word, no verb. Rather than guess, Sifty asks one question — answer it and the task gets sifted again.",
        subtasks: [],
      },
    },
  ];
}
