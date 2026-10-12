import { closeDb, getDb, schema } from "@/lib/db/client";
import { createPostgresRepos } from "@/lib/db/repos/pg";
import { sql } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { describeRepoContract } from "./repo-contract";

/**
 * Repository contract against a real Postgres.
 *
 * Skipped unless `TEST_DATABASE_URL` points at a migrated database (run
 * `DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate` first). CI provides one
 * through a `postgres` service container for PRs into `production`; locally
 * any scratch database works. Every table is truncated before each case so
 * the cases stay independent, which means: never point this at real data.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres repos", () => {
  const repos = createPostgresRepos();

  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });

  beforeEach(async () => {
    const tables = Object.values(schema)
      .filter((t) => typeof t === "object" && t !== null && "getSQL" in t)
      .map((t) => getTableName(t as Parameters<typeof getTableName>[0]));
    const list = tables.map((name) => `"${name}"`).join(", ");
    await getDb().execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  });

  afterAll(async () => {
    await closeDb();
  });

  describeRepoContract(() => repos);
});
