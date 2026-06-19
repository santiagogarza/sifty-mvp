import { NextResponse } from "next/server";
import { triageTask } from "@/lib/ai/triage";
import { getTask, updateTask } from "@/lib/store";

// Simulates the durable background enrichment job described in the plan.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const result = triageTask(task);
  const updated = updateTask(id, {
    title: result.title,
    description: result.description,
    urgency: result.urgency,
    importance: result.importance,
    effort: result.effort,
    nextAction: result.nextAction,
    labels: result.labels,
    confidence: result.confidence,
    aiStatus: "done",
  });

  return NextResponse.json({ task: updated });
}
