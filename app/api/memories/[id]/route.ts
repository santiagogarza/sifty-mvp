import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { MEMORY_LIMITS } from "@/lib/domain/limits";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    text: z.string().min(1).max(MEMORY_LIMITS.text).optional(),
    pinned: z.boolean().optional(),
    kind: z.enum(["preference", "fact", "context"]).optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const memory = await getRepos().memories.update(session.user.id, id, parsed.data);
  if (!memory) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ memory });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const ok = await getRepos().memories.delete(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
