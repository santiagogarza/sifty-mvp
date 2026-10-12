import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { EXECUTION_POLICIES, EXECUTION_POLICY_SCOPES } from "@/lib/domain/types";
import { DEFAULT_EXECUTION_POLICY } from "@/lib/executions/policy";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const POLICIES_LIMIT = 200;

const Target = z.object({
  scope: z.enum(EXECUTION_POLICY_SCOPES),
  /** Task id or connector slug. */
  key: z.string().min(1).max(120),
});

const PutBody = Target.extend({ policy: z.enum(EXECUTION_POLICIES) }).strict();

/**
 * The user's saved execution policies. `GET ?scope=task&key=…` reads one
 * (the default when none is saved); `GET ?scope=connector` lists a scope.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(req.url);
  const scope = z.enum(EXECUTION_POLICY_SCOPES).safeParse(url.searchParams.get("scope"));
  if (!scope.success) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const repos = getRepos();
  const key = url.searchParams.get("key");
  if (key) {
    const saved = await repos.executionPolicies.get(session.user.id, scope.data, key);
    return NextResponse.json({
      scope: scope.data,
      key,
      policy: saved?.policy ?? DEFAULT_EXECUTION_POLICY,
      saved: !!saved,
      default: DEFAULT_EXECUTION_POLICY,
    });
  }
  const policies = await repos.executionPolicies.list(session.user.id, scope.data, {
    limit: POLICIES_LIMIT,
  });
  return NextResponse.json({ scope: scope.data, policies, default: DEFAULT_EXECUTION_POLICY });
}

/** Save a policy for one task or one connector. */
export async function PUT(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { scope, key, policy } = parsed.data;
  const repos = getRepos();
  if (scope === "task") {
    const task = await repos.tasks.get(session.user.id, key);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const saved = await repos.executionPolicies.set(session.user.id, scope, key, policy);
  return NextResponse.json({ policy: saved });
}

/** Back to the default for one task or connector. */
export async function DELETE(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = Target.strict().safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const cleared = await getRepos().executionPolicies.clear(
    session.user.id,
    parsed.data.scope,
    parsed.data.key,
  );
  return NextResponse.json({ cleared, default: DEFAULT_EXECUTION_POLICY });
}
