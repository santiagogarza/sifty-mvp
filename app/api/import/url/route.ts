import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { fetchRemoteNote } from "@/lib/import/remote-note";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Import a remote note into the inbox. Intended for bookmarklets and
 * automation hooks that POST a public URL to scrape.
 */
export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const url = typeof json?.url === "string" ? json.url : null;
  const userId = session.user.id;
  const sourceText =
    typeof json?.sourceText === "string" ? json.sourceText : null;

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let imported = sourceText;
  if (!imported) {
    try {
      imported = await fetchRemoteNote(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const trimmed = imported.trim().slice(0, 8000);
  if (!trimmed) {
    return NextResponse.json(
      { error: "Remote note was empty" },
      { status: 400 },
    );
  }

  const task = await getRepos().tasks.create(userId, {
    sourceText: trimmed,
    sourceContext: url,
  });

  return NextResponse.json({ task }, { status: 201 });
}
