import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Postgres client + Drizzle handle.
 *
 * Built lazily so importing this module never opens a connection. Routes and
 * server actions call `getDb()` — tests that mock the repos never touch this.
 *
 * Production: `DATABASE_URL` must be set (Vercel Postgres, Neon, Supabase
 * Postgres, etc.). If unset, this module throws on first use, which the
 * route handlers convert to a 503 with a clear message.
 */

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured. Set it in `.env.local` or your deploy environment.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  _client = postgres(url, {
    max: process.env.NODE_ENV === "production" ? 10 : 1,
    prepare: false,
    onnotice: () => {},
  });
  _db = drizzle(_client, { schema });
  return _db;
}

/** Test/utility: dispose pool. */
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

export { schema };
