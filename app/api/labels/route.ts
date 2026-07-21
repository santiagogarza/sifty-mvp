import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { ClientId } from "@/lib/domain/task-patch-schema";
import { LABEL_TONES } from "@/lib/domain/types";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const labels = await getRepos().labels.list(session.user.id);
  return NextResponse.json({ labels });
}

const EnsureBody = z.object({
  id: ClientId,
  name: z.string().min(1).max(24),
  tone: z.enum(LABEL_TONES),
});

/**
 * Idempotent ensure-by-name. Returns the canonical label — which may differ
 * from the submitted one when the name already exists (e.g. two devices
 * created "Errand" concurrently). The client must adopt the returned id.
 */
export async function PUT(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = EnsureBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const label = await getRepos().labels.ensure(session.user.id, parsed.data);
  return NextResponse.json({ label });
}
