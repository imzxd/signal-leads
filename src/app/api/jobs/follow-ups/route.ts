import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { processDueFollowUps } from "@/server/jobs/follow-ups";
import { bearerMatches } from "@/lib/security/api-auth";
import { env } from "@/lib/env";

/**
 * Follow-up worker trigger. Call every 1–5 minutes from n8n, Vercel Cron or any scheduler:
 *   Authorization: Bearer $CRON_SECRET
 * Safe to call concurrently and repeatedly — claims are atomic and sends are idempotent.
 */
async function run(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), env().CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processDueFollowUps(await getDb());
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = run;
export const POST = run;
