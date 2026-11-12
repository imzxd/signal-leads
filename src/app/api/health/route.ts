import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDatabaseHandle } from "@/server/db/client";
import { describeAIMode } from "@/ai/providers";

export async function GET() {
  try {
    const h = await getDatabaseHandle();
    await h.db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: h.driver, ai: describeAIMode().label });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
