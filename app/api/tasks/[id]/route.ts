import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import {
  AI_STATUS,
  DELEGATION_CANDIDATE,
  EFFORT,
  LIFECYCLE,
  PRIORITY_BUCKET,
  TASK_EDITABLE_FIELDS,
} from "@/lib/domain/types";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    title: z.string().min(1).max(280).optional(),
    description: z.string().max(4000).nullable().optional(),
    nextAction: z.string().max(280).nullable().optional(),
    lifecycle: z.enum(LIFECYCLE).optional(),
    aiStatus: z.enum(AI_STATUS).optional(),
    aiError: z.string().max(2000).nullable().optional(),
    aiAttempts: z.number().int().nonnegative().optional(),
    urgency: z.number().min(0).max(1).optional(),
    importance: z.number().min(0).max(1).optional(),
    priorityBucket: z.enum(PRIORITY_BUCKET).optional(),
    effort: z.enum(EFFORT).optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    delegationCandidate: z.enum(DELEGATION_CANDIDATE).optional(),
    confidence: z.number().min(0).max(1).optional(),
    clarifyingQuestion: z.string().max(500).nullable().optional(),
    rationale: z.string().max(2000).nullable().optional(),
    labelIds: z.array(z.string()).max(20).optional(),
    subtasks: z
      .array(
        z.object({
          id: z.string(),
          title: z.string().min(1).max(160),
          done: z.boolean(),
          order: z.number().int().nonnegative(),
        }),
      )
      .max(20)
      .optional(),
    editedFields: z.array(z.enum(TASK_EDITABLE_FIELDS)).max(20).optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const task = await getRepos().tasks.get(session.user.id, id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { editedFields, ...patch } = parsed.data;
  const task = await getRepos().tasks.update(session.user.id, id, patch, { editedFields });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ok = await getRepos().tasks.delete(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
