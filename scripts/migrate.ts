/**
 * pnpm db:migrate — apply supabase/migrations to DATABASE_URL (or the local embedded database).
 * For hosted Supabase you can alternatively use `supabase db push`.
 */
import { getDatabaseHandle } from "../src/server/db/client";
import { applyMigrations } from "../src/server/db/migrate";

const handle = await getDatabaseHandle(); // local PGlite migrates (and seeds) on open
if (handle.driver === "postgres") {
  const applied = await applyMigrations(handle.raw);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} else {
  console.log("Local embedded database is migrated and ready (.data/pglite).");
}
await handle.close();
