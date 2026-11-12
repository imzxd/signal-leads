/**
 * pnpm db:reset — delete the LOCAL embedded database and rebuild it from migrations + demo seed.
 * Refuses to touch DATABASE_URL targets.
 */
import path from "node:path";
import { rmSync } from "node:fs";

if (process.env.DATABASE_URL) {
  console.error("db:reset only works on the local embedded database. Unset DATABASE_URL to use it.");
  process.exit(1);
}
const dir = process.env.SIGNAL_PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
const { getDatabaseHandle } = await import("../src/server/db/client");
const handle = await getDatabaseHandle();
console.log("Rebuilt local database with the Evergreen Roofing demo.");
await handle.close();
