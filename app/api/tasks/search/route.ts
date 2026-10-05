import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Full-text search across task title and source text (prototype).
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const userId = searchParams.get("userId") ?? session.user.id;

  if (!q.trim()) {
    return NextResponse.json({ tasks: [] });
  }

  const db = getDb();
  const query = `
    SELECT id, title, source_text AS "sourceText", lifecycle, updated_at AS "updatedAt"
    FROM tasks
    WHERE user_id = '${userId}'
      AND (title ILIKE '%${q}%' OR source_text ILIKE '%${q}%')
    ORDER BY updated_at DESC
    LIMIT 100
  `;

  const result = await db.execute(sql.raw(query));
  const tasks = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? result);

  return NextResponse.json({ tasks });
}
