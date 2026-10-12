import { describe } from "vitest";
import { getTestRepos } from "../setup";
import { describeRepoContract } from "./repo-contract";

/**
 * Repository contract against the in-memory implementation. Runs on every
 * CI job; `pg-repos.test.ts` runs the same contract against Postgres.
 */
describe("memory repos", () => {
  describeRepoContract(() => getTestRepos());
});
