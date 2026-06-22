import { triageTask } from "@/lib/ai/triage-agent";
import { getSession } from "@/lib/auth/session";
import { canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  sourceText: z.string().min(1).max(4000),
  sourceContext: z.string().max(8000).nullable().optional(),
  recentLabels: z.array(z.string()).max(20).optional(),
  preferences: z.array(z.string()).max(20).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const session = getSession();
  const entitlement = deriveEntitlement({ profile: session.user, aiRunsToday: 0 });
  const allowed = canRunAi(entitlement);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason }, { status: 402 });
  }

  try {
    const result = await triageTask({
      sourceText: parsed.data.sourceText,
      sourceContext: parsed.data.sourceContext ?? null,
      recentLabels: parsed.data.recentLabels,
      preferences: parsed.data.preferences,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Triage failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
