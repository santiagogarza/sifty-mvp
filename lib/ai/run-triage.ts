"use client";

import { useStore } from "@/lib/store/store";
import { id as makeId } from "@/lib/utils/ids";

/**
 * Client-side triage driver.
 *
 * Calls the `/api/triage` route and applies the result to the store. Adds a
 * tiny minimum visible duration so the "AI is organizing" state never
 * flashes — calm UI matters more than millisecond optimization.
 */
export async function runTriage(taskId: string): Promise<void> {
  const store = useStore.getState();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return;

  store.setAiStatus(taskId, "running");
  const startedAt = Date.now();

  try {
    const recentLabels = store.labels.slice(0, 6).map((l) => l.name);
    const preferences = store.memories.filter((m) => m.pinned).map((m) => m.text);
    const modelId = store.preferredModelId;

    const res = await fetch("/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        sourceText: task.sourceText,
        sourceContext: task.sourceContext,
        recentLabels,
        preferences,
        modelId,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Triage failed (${res.status})`);
    }
    const data: {
      output: {
        title: string;
        description: string | null;
        nextAction: string | null;
        urgency: number;
        importance: number;
        effort: "quick" | "small" | "medium" | "deep";
        dueHint: string | null;
        delegationCandidate: "self" | "ai" | "person" | "unsure";
        suggestedLabels: string[];
        subtasks: string[];
        rationale: string | null;
        confidence: number;
        clarifyingQuestion: string | null;
      };
    } = await res.json();

    const labelIds = data.output.suggestedLabels.map((name) => store.ensureLabel(name).id);
    const subtasks = data.output.subtasks.map((title, order) => ({
      id: makeId("st"),
      title,
      done: false,
      order,
    }));

    const minDelayMs = 450;
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDelayMs) await new Promise((r) => setTimeout(r, minDelayMs - elapsed));

    useStore.getState().applyTriage(taskId, {
      title: data.output.title,
      description: data.output.description,
      nextAction: data.output.nextAction,
      urgency: data.output.urgency,
      importance: data.output.importance,
      effort: data.output.effort,
      due: data.output.dueHint,
      delegationCandidate: data.output.delegationCandidate,
      labelIds,
      subtasks,
      rationale: data.output.rationale,
      confidence: data.output.confidence,
      clarifyingQuestion: data.output.clarifyingQuestion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Triage failed";
    useStore.getState().setAiStatus(taskId, "failed", message);
  }
}
