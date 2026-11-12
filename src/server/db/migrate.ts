import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";

export interface RawExecutor {
  exec: (sql: string) => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
}

function migrationsDir() {
  return path.join(process.cwd(), "supabase", "migrations");
}

/**
 * Applies supabase/migrations/*.sql in filename order, tracking applied versions in
 * public.schema_migrations. Each file runs inside a transaction.
 *
 * On hosted Supabase prefer `supabase db push`, which records migrations in its own
 * table; this runner is for the embedded database and plain Postgres targets.
 */
export async function applyMigrations(raw: RawExecutor, opts: { includeLocalShim?: boolean } = {}): Promise<string[]> {
  if (opts.includeLocalShim) {
    const shim = readFileSync(path.join(process.cwd(), "supabase", "local", "00_supabase_shim.sql"), "utf8");
    await raw.exec(shim);
  }
  await raw.exec(`create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  const appliedRows = await raw.query("select version from public.schema_migrations");
  const applied = new Set(appliedRows.map((r) => String(r.version)));
  const files = readdirSync(migrationsDir())
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sqlText = readFileSync(path.join(migrationsDir(), file), "utf8");
    try {
      await raw.exec(`begin;\n${sqlText}\ninsert into public.schema_migrations(version) values ('${version.replace(/'/g, "''")}');\ncommit;`);
    } catch (error) {
      await raw.exec("rollback;").catch(() => undefined);
      throw new Error(`Migration ${version} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    newlyApplied.push(version);
  }
  return newlyApplied;
}
