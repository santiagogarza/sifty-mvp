import type { Repos } from "@/lib/db/repos";
import { seedDefaultLabels } from "@/lib/demo/seed-demo";
import { id as makeId } from "@/lib/utils/ids";
import { EXAMPLE_LABEL_NAME, starterTasks } from "./starter-tasks";

/**
 * Starter workspace for a brand-new account: the default label palette plus
 * three sifted example tasks. Strictly first-run — an account with any task
 * or memory is left alone, so deleting the examples (or everything) sticks.
 * Independent of `SIFTY_DEMO_SEED`, which replaces this with the full demo
 * workspace for local demos only.
 */
export async function seedStarterWorkspaceIfEmpty(repos: Repos, userId: string): Promise<boolean> {
  const labelIdsByName = await seedDefaultLabels(repos, userId);

  const [tasks, memories] = await Promise.all([
    repos.tasks.list(userId),
    repos.memories.list(userId),
  ]);
  if (tasks.length > 0 || memories.length > 0) return false;

  const example = await repos.labels.ensure(userId, {
    id: makeId("label"),
    name: EXAMPLE_LABEL_NAME,
    tone: "mist",
  });
  labelIdsByName.set(example.name, example.id);

  for (const starter of starterTasks()) {
    const created = await repos.tasks.create(userId, {
      sourceText: starter.sourceText,
      sourceContext: starter.sourceContext,
    });
    const labelIds = starter.labelNames
      .map((name) => labelIdsByName.get(name))
      .filter((id): id is string => !!id);
    await repos.tasks.update(userId, created.id, { ...starter.patch, labelIds });
  }
  return true;
}
