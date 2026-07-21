import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { IdConflictError } from "@/lib/db/repos/types";
import { MEMORY_LIMITS } from "@/lib/domain/limits";
import { ClientId } from "@/lib/domain/task-patch-schema";
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
  /** Client-generated id for optimistic sync; create is idempotent per id. */
  id: ClientId.optional(),
  text: z.string().min(1).max(MEMORY_LIMITS.text),
  kind: z.enum(["preference", "fact", "context"]).optional(),
  pinned: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const memory = await getRepos().memories.create(session.user.id, parsed.data);
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    if (err instanceof IdConflictError) {
      return NextResponse.json({ error: "Memory id is not available" }, { status: 409 });
    }
    throw err;
  }
}
