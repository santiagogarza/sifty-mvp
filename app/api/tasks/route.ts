import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ tasks: listTasks() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceText =
    typeof body === "object" && body !== null && "sourceText" in body
      ? String((body as { sourceText: unknown }).sourceText ?? "")
      : "";

  if (sourceText.trim().length === 0) {
    return NextResponse.json({ error: "sourceText is required" }, { status: 400 });
  }

  const task = createTask({ sourceText: sourceText.trim() });
  return NextResponse.json({ task }, { status: 201 });
}
