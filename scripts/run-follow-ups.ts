/**
 * pnpm jobs:follow-ups — process due follow-ups once (for cron, or run in a loop with --watch).
 * In production, schedule POST /api/jobs/follow-ups from n8n/Vercel Cron instead.
 */
import { getDatabaseHandle } from "../src/server/db/client";
import { processDueFollowUps } from "../src/server/jobs/follow-ups";

const handle = await getDatabaseHandle();
const watch = process.argv.includes("--watch");
do {
  const result = await processDueFollowUps(handle.db);
  console.log(new Date().toISOString(), JSON.stringify(result));
  if (watch) await new Promise((r) => setTimeout(r, 60_000));
} while (watch);
await handle.close();
