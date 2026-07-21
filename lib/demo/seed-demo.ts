import type { Repos } from "@/lib/db/repos";
import { id as makeId } from "@/lib/utils/ids";
import { DEFAULT_LABELS, demoMemories, demoTasks, isoDaysAgo } from "./demo-data";

/**
 * Workspace seeding.
 *
 * - Every new account gets the default label palette so triage suggestions
 *   and manual labeling start from a sensible vocabulary.
 * - With `SIFTY_DEMO_SEED=1`, a new account is additionally populated with
 *   a fully-triaged demo workspace (tasks across all views, memories, one
 *   agent brief). Seeding is strictly first-run: an account that already
 *   has any task or memory is never touched, so clearing your data stays
 *   cleared.
 */

export function isDemoSeedEnabled(): boolean {
  return process.env.SIFTY_DEMO_SEED === "1";
}

export async function seedDefaultLabels(
  repos: Repos,
  userId: string,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const seed of DEFAULT_LABELS) {
    const label = await repos.labels.ensure(userId, {
      id: makeId("label"),
      name: seed.name,
      tone: seed.tone,
    });
    byName.set(label.name, label.id);
  }
  return byName;
}

export async function seedDemoWorkspaceIfEmpty(repos: Repos, userId: string): Promise<boolean> {
  const [tasks, memories] = await Promise.all([
    repos.tasks.list(userId),
    repos.memories.list(userId),
  ]);
  if (tasks.length > 0 || memories.length > 0) return false;

  const labelIdsByName = await seedDefaultLabels(repos, userId);

  await Promise.all(
    demoMemories().map((m) =>
      repos.memories.create(userId, {
        text: m.text,
        kind: m.kind,
        pinned: m.pinned,
      }),
    ),
  );

  await Promise.all(
    demoTasks().map(async (demo) => {
      const created = await repos.tasks.create(userId, {
        sourceText: demo.sourceText,
        sourceContext: demo.sourceContext,
        createdAt: isoDaysAgo(demo.createdDaysAgo),
      });
      const labelIds = demo.labelNames
        .map((name) => labelIdsByName.get(name))
        .filter((id): id is string => !!id);
      await repos.tasks.update(userId, created.id, { ...demo.patch, labelIds });
    }),
  );

  return true;
}
