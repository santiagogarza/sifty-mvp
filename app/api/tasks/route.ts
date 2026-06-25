import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tasks = await getRepos().tasks.list(session.user.id);
  return NextResponse.json({ tasks });
}

const CreateBody = z.object({
  sourceText: z.string().min(1).max(4000),
  sourceContext: z.string().max(8000).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const task = await getRepos().tasks.create(session.user.id, {
    sourceText: parsed.data.sourceText,
    sourceContext: parsed.data.sourceContext ?? null,
  });
  return NextResponse.json({ task }, { status: 201 });
}
