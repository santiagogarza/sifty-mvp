import type { Label, Memory, Task } from "@/lib/domain/types";
import { id } from "@/lib/utils/ids";

/**
 * Seed data.
 *
 * Three principles for empty-state seeds:
 * 1. The default state should still feel intentional, not like "demo content".
 *    We seed labels that real users will keep, and a small set of tasks that
 *    showcase different lifecycle states without being noisy.
 * 2. Every seeded task is functional. Buttons work, edits stick.
 * 3. If the user clears everything, the app should not re-seed silently.
 */

export function seedLabels(): Label[] {
  return [
    { id: "label_personal", name: "Personal", tone: "sand" },
    { id: "label_work", name: "Work", tone: "neutral" },
    { id: "label_cursor", name: "Cursor", tone: "ember" },
    { id: "label_writing", name: "Writing", tone: "mist" },
    { id: "label_admin", name: "Admin", tone: "neutral" },
    { id: "label_errand", name: "Errand", tone: "sage" },
  ];
}

export function seedMemories(): Memory[] {
  const now = new Date().toISOString();
  return [
    {
      id: id("mem"),
      kind: "preference",
      pinned: true,
      createdAt: now,
      text: "Default work hours are 9am–6pm. Avoid scheduling deep work after 4pm.",
    },
    {
      id: id("mem"),
      kind: "fact",
      pinned: false,
      createdAt: now,
      text: "I split projects between Cursor work and personal writing.",
    },
  ];
}

export function seedTasks(): Task[] {
  const now = new Date();
  const iso = (offsetDays: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };
  const dueIso = (offsetDays: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };

  return [
    {
      id: id("task"),
      sourceText: "Draft the launch announcement for the Sifty preview by Friday",
      sourceContext: null,
      title: "Draft launch announcement for Sifty preview",
      description: null,
      nextAction: "Write a one-paragraph outline of audience, message, and proof points.",
      lifecycle: "active",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.75,
      importance: 0.85,
      priorityBucket: "do_now",
      effort: "medium",
      due: dueIso(2),
      delegationCandidate: "self",
      confidence: 0.82,
      clarifyingQuestion: null,
      rationale: "Heuristic triage. Matched importance and date phrases.",
      labelIds: ["label_work", "label_writing"],
      subtasks: [
        { id: id("st"), title: "List the 3 core proof points", done: false, order: 0 },
        { id: id("st"), title: "Write the outline", done: false, order: 1 },
        { id: id("st"), title: "Draft and read aloud", done: false, order: 2 },
      ],
      editedFields: [],
      createdAt: iso(-1),
      updatedAt: iso(-1),
      completedAt: null,
    },
    {
      id: id("task"),
      sourceText: "Reply to the contractor about the bathroom estimate",
      sourceContext: null,
      title: "Reply to the contractor about the bathroom estimate",
      description: null,
      nextAction: "Send the message now.",
      lifecycle: "inbox",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.55,
      importance: 0.4,
      priorityBucket: "delegate",
      effort: "quick",
      due: null,
      delegationCandidate: "self",
      confidence: 0.68,
      clarifyingQuestion: null,
      rationale: "Heuristic triage. Quick task pattern detected.",
      labelIds: ["label_personal", "label_admin"],
      subtasks: [],
      editedFields: [],
      createdAt: iso(-0.2),
      updatedAt: iso(-0.2),
      completedAt: null,
    },
    {
      id: id("task"),
      sourceText: "Investigate streaming SSR options for the dashboard",
      sourceContext:
        "Some pages still hydrate slowly on iOS Safari. Want to scope what changes when we move to streaming.",
      title: "Investigate streaming SSR options for the dashboard",
      description:
        "Some pages still hydrate slowly on iOS Safari. Want to scope what changes when we move to streaming.",
      nextAction: "Block 30 min and write a one-paragraph outline.",
      lifecycle: "active",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.45,
      importance: 0.65,
      priorityBucket: "schedule",
      effort: "deep",
      due: null,
      delegationCandidate: "ai",
      confidence: 0.72,
      clarifyingQuestion: null,
      rationale: "Heuristic triage. Matched a deep-work phrase; task is AI-suitable.",
      labelIds: ["label_work", "label_cursor"],
      subtasks: [
        { id: id("st"), title: "Read current Next docs on streaming", done: true, order: 0 },
        { id: id("st"), title: "Write a one-pager comparing options", done: false, order: 1 },
      ],
      editedFields: [],
      createdAt: iso(-3),
      updatedAt: iso(-1),
      completedAt: null,
    },
    {
      id: id("task"),
      sourceText: "Pick up the dry cleaning",
      sourceContext: null,
      title: "Pick up the dry cleaning",
      description: null,
      nextAction: "Stop by on the way home.",
      lifecycle: "active",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.55,
      importance: 0.25,
      priorityBucket: "delegate",
      effort: "quick",
      due: dueIso(1),
      delegationCandidate: "self",
      confidence: 0.78,
      clarifyingQuestion: null,
      rationale: "Heuristic triage. Quick task pattern detected.",
      labelIds: ["label_personal", "label_errand"],
      subtasks: [],
      editedFields: [],
      createdAt: iso(-0.5),
      updatedAt: iso(-0.5),
      completedAt: null,
    },
    {
      id: id("task"),
      sourceText: "Read the new Things 3 review and note what feels different",
      sourceContext: null,
      title: "Read the Things 3 review and note what feels different",
      description: null,
      nextAction: "Decide the first concrete step.",
      lifecycle: "someday",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.2,
      importance: 0.45,
      priorityBucket: "schedule",
      effort: "small",
      due: null,
      delegationCandidate: "self",
      confidence: 0.66,
      clarifyingQuestion: null,
      rationale: "No strong signals — defaulting to a balanced triage.",
      labelIds: ["label_personal", "label_writing"],
      subtasks: [],
      editedFields: [],
      createdAt: iso(-7),
      updatedAt: iso(-7),
      completedAt: null,
    },
  ];
}
