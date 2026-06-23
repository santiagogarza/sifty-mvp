import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const memories = await getRepos().memories.list(session.user.id);
  return NextResponse.json({ memories });
}

const CreateBody = z.object({
  text: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const memory = await getRepos().memories.create(session.user.id, parsed.data.text);
  return NextResponse.json({ memory }, { status: 201 });
}
