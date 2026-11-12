/**
 * Database access.
 *
 * - Production: DATABASE_URL → Supabase Postgres via postgres.js.
 * - Local / demo / tests: an embedded PGlite instance (real Postgres + pgvector in WASM)
 *   running the exact same supabase/migrations, so there is a single SQL code path.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "@/lib/env";
import { applyMigrations, type RawExecutor } from "./migrate";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: "pglite" | "postgres";
  raw: RawExecutor;
  close: () => Promise<void>;
}

type GlobalWithDb = typeof globalThis & { __signalDb?: Promise<DatabaseHandle> };
const g = globalThis as GlobalWithDb;

export function getDatabaseHandle(): Promise<DatabaseHandle> {
  if (!g.__signalDb) {
    g.__signalDb = createDatabase().catch((error) => {
      g.__signalDb = undefined;
      throw error;
    });
  }
  return g.__signalDb;
}

export async function getDb(): Promise<Database> {
  return (await getDatabaseHandle()).db;
}

/** For tests: replace the global handle (e.g. with an in-memory database). */
export function setDatabaseHandle(handle: Promise<DatabaseHandle> | undefined) {
  g.__signalDb = handle;
}

async function createDatabase(): Promise<DatabaseHandle> {
  const url = env().DATABASE_URL;
  if (url) return createPostgres(url);
  const dir = env().SIGNAL_PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const handle = await createPglite(dir);
  await applyMigrations(handle.raw, { includeLocalShim: true });
  // Local databases bootstrap themselves with the demo organization so `pnpm dev` just works.
  const { ensureDemoOrganization } = await import("@/server/seed/demo");
  await ensureDemoOrganization(handle.db);
  return handle;
}

async function createPostgres(url: string): Promise<DatabaseHandle> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    max: 10,
    prepare: false, // required for Supabase's transaction pooler
    idle_timeout: 20,
  });
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    driver: "postgres",
    raw: { exec: async (sqlText: string) => void (await client.unsafe(sqlText)), query: async (q, p) => (await client.unsafe(q, (p ?? []) as never[])) as unknown as Record<string, unknown>[] },
    close: () => client.end(),
  };
}

export async function createPglite(dataDir: string): Promise<DatabaseHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir, { extensions: { vector, pgcrypto } });
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    driver: "pglite",
    raw: {
      exec: async (sqlText: string) => void (await client.exec(sqlText)),
      query: async (q, p) => (await client.query<Record<string, unknown>>(q, p as unknown[])).rows,
    },
    close: () => client.close(),
  };
}

/** Run a raw drizzle `sql` query and return rows, regardless of driver. */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
