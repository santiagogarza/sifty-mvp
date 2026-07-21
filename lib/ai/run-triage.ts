"use client";

import { AI_CONTEXT_LIMITS, TASK_LIMITS } from "@/lib/domain/limits";
import type { Label, Task } from "@/lib/domain/types";
import { getSyncHooks, useStore } from "@/lib/store/store";
import { id as makeId } from "@/lib/utils/ids";

/**
 * Client-side triage driver.
 *
 * Waits for the task's create push to settle (so the server can persist the
 * result durably), calls `/api/triage`, then adopts the server-applied task
 * when the route returns one. When the task never reached the server (e.g.
 * offline capture), it falls back to applying the output locally; the sync
 * layer reconciles later.
 *
 * A tiny minimum visible duration keeps the "AI is organizing" state from
 * flashing — calm UI matters more than millisecond optimization.
 */

const inFlight = new Set<string>();

export function isTriageInFlight(taskId: string): boolean {
  return inFlight.has(taskId);
}

interface TriageResponse {
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
  /** Canonical server task when the route applied the result durably. */
  task: Task | null;
  labels: Label[];
}

export async function runTriage(taskId: string): Promise<void> {
  const store = useStore.getState();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task || inFlight.has(taskId)) return;

  inFlight.add(taskId);
  store.setAiStatus(taskId, "running");
  const startedAt = Date.now();

  try {
    // Let the create push land first so the server-side apply finds the row.
    await getSyncHooks()?.waitForTask(taskId);

    const state = useStore.getState();
    const current = state.tasks.find((t) => t.id === taskId);
    if (!current) return;

    // Clamped to the shared wire limits so the request can't be rejected
    // for legacy oversized content or an over-pinned memory list.
    const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
    const res = await fetch("/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        sourceText: clip(current.sourceText, TASK_LIMITS.sourceText),
        sourceContext: current.sourceContext
          ? clip(current.sourceContext, TASK_LIMITS.sourceContext)
          : current.sourceContext,
        recentLabels: state.labels.slice(0, 6).map((l) => l.name),
        preferences: state.memories
          .filter((m) => m.pinned)
          .slice(0, AI_CONTEXT_LIMITS.maxPreferences)
          .map((m) => m.text),
        modelId: state.preferredModelId,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `Triage failed (${res.status})`);
    }
    const data = (await res.json()) as TriageResponse;

    const minDelayMs = 450;
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDelayMs) await new Promise((r) => setTimeout(r, minDelayMs - elapsed));

    if (data.task && !getSyncHooks()?.isTaskDirty(taskId)) {
      // Server applied the result durably and no local edit raced it —
      // adopt the canonical server state wholesale.
      const s = useStore.getState();
      s.upsertLabels(data.labels);
      s.replaceTaskFromServer(data.task);
      return;
    }

    // Apply locally: either the task never reached the server, or the user
    // edited it while triage ran (the local `editedFields` are the freshest
    // protection). `applyTriage` merges with protection and pushes, so the
    // server converges on the same result.
    const s = useStore.getState();
    let labelIds: string[];
    if (data.task) {
      // Reuse the canonical labels the server ensured (same order as
      // `suggestedLabels`), so both sides reference identical label ids.
      s.upsertLabels(data.labels);
      labelIds = data.labels.map((l) => l.id);
    } else {
      labelIds = data.output.suggestedLabels.map((name) => s.ensureLabel(name).id);
    }
    const subtasks = data.output.subtasks.map((title, order) => ({
      id: makeId("st"),
      title,
      done: false,
      order,
    }));
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
  } finally {
    inFlight.delete(taskId);
  }
}
