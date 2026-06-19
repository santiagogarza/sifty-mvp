import { NextResponse } from "next/server";
import { deleteTask, getTask, updateTask } from "@/lib/store";
import type { Task } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getTask(id)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: Partial<Task>;
  try {
    body = (await request.json()) as Partial<Task>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed: Partial<Task> = {};
  if (body.status) allowed.status = body.status;
  if (body.title !== undefined) allowed.title = body.title;
  if (body.description !== undefined) allowed.description = body.description;

  const task = updateTask(id, allowed);
  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteTask(id);
  if (!ok) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
