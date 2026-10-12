import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { countByKind, listOpen } from "@/lib/decisions/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Newest first; the inbox is for acting, not archaeology. */
const OPEN_LIMIT = 50;

/**
 * The Decisions inbox: every open decision for the signed-in user, newest
 * first, plus a summary of each referenced task so the client can render
 * a question before (or without) the full task sync.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const userId = session.user.id;
  const repos = getRepos();

  const [decisions, count] = await Promise.all([
    listOpen(userId, { limit: OPEN_LIMIT }),
    repos.decisions.countOpen(userId),
  ]);
  const taskIds = Array.from(
    new Set(decisions.map((d) => d.taskId).filter((id): id is string => !!id)),
  );
  const tasks = (await Promise.all(taskIds.map((id) => repos.tasks.get(userId, id)))).flatMap(
    (task) =>
      task
        ? [
            {
              id: task.id,
              title: task.title,
              sourceText: task.sourceText,
              lifecycle: task.lifecycle,
            },
          ]
        : [],
  );
  return NextResponse.json({ decisions, tasks, count, byKind: countByKind(decisions) });
}
