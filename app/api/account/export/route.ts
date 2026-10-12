import { exportAccount } from "@/lib/auth/account";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Everything the signed-in user owns, as a downloadable JSON file. */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const data = await exportAccount(getRepos(), session.user.id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const day = data.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="sifty-export-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
