import { acquireUserSlot } from "./user-lock";

/**
 * Smallest possible workflow: one step, one return value.
 *
 * Exists so an operator can prove the Workflow runtime works on a given
 * deployment (queue trigger, OIDC, storage) before trusting it with real
 * sifts: `POST /api/admin/workflow-ping` as the creator. It also takes the
 * per-user slot lock, so a misbehaving lock shows up here first; `holdMs`
 * keeps the slot busy long enough to watch a second ping wait for it.
 */
export interface PingResult {
  echo: string;
  startedAt: string;
  finishedAt: string;
}

export async function pingWorkflow(userId: string, echo: string, holdMs = 0): Promise<PingResult> {
  "use workflow";
  await acquireUserSlot("ping", userId, 1);
  const startedAt = await stamp();
  const reply = await echoStep(echo, holdMs);
  const finishedAt = await stamp();
  console.log(`[workflow] ping ${reply} done`);
  return { echo: reply, startedAt, finishedAt };
}

async function stamp(): Promise<string> {
  "use step";
  return new Date().toISOString();
}

async function echoStep(value: string, holdMs: number): Promise<string> {
  "use step";
  console.log(`[workflow] ping step: ${value} (hold ${holdMs}ms)`);
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
  return value;
}
