import type { Priority, Task } from "@/lib/types";

export interface TriageResult {
  title: string;
  description: string | null;
  urgency: Priority;
  importance: Priority;
  effort: "S" | "M" | "L";
  nextAction: string;
  labels: string[];
  confidence: number;
}

const URGENT_HINTS = ["today", "asap", "urgent", "now", "tonight", "deadline", "due"];
const WORK_HINTS = ["meeting", "report", "email", "deck", "review", "ship", "deploy", "cursor"];
const PERSONAL_HINTS = ["buy", "call mom", "doctor", "groceries", "gym", "family"];
const ADMIN_HINTS = ["pay", "invoice", "renew", "file", "expense"];

function titleize(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return "Untitled task";
  const first = cleaned[0].toUpperCase() + cleaned.slice(1);
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

// Local heuristic triage. The plan calls for AI enrichment via the Vercel AI
// Gateway, but the capture loop must degrade gracefully when no AI provider is
// configured. This deterministic fallback keeps the full capture -> enrich ->
// review loop runnable with no external secrets.
export function triageTask(task: Task): TriageResult {
  const text = task.sourceText.toLowerCase();

  const isUrgent = URGENT_HINTS.some((h) => text.includes(h));
  const labels = new Set<string>();
  if (WORK_HINTS.some((h) => text.includes(h))) labels.add("Work");
  if (PERSONAL_HINTS.some((h) => text.includes(h))) labels.add("Personal");
  if (ADMIN_HINTS.some((h) => text.includes(h))) labels.add("Admin");
  if (labels.size === 0) labels.add("Inbox");

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const effort: "S" | "M" | "L" = wordCount <= 4 ? "S" : wordCount <= 12 ? "M" : "L";

  return {
    title: titleize(task.sourceText),
    description: task.sourceText.trim().length > 80 ? task.sourceText.trim() : null,
    urgency: isUrgent ? "high" : "medium",
    importance: labels.has("Work") ? "high" : "medium",
    effort,
    nextAction: `Start: ${titleize(task.sourceText)}`,
    labels: Array.from(labels),
    confidence: isUrgent || labels.size > 1 ? 0.82 : 0.65,
  };
}
