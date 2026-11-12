"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOrgContext, requireRole } from "@/lib/auth/session";
import { automations } from "@/server/db/schema";
import { audit } from "@/server/repositories/audit";
import { processDueFollowUps } from "@/server/jobs/follow-ups";
import { act } from "./result";

export async function toggleAutomationAction(automationId: string, enabled: boolean) {
  return act("toggleAutomation", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    const [row] = await ctx.db
      .update(automations)
      .set({ enabled: z.boolean().parse(enabled) })
      .where(and(eq(automations.id, z.string().uuid().parse(automationId)), eq(automations.organizationId, ctx.organizationId)))
      .returning();
    if (!row) throw new Error("Automation not found");
    await audit(ctx, enabled ? "automation.enabled" : "automation.disabled", "automation", row.id, { key: row.key });
    revalidatePath("/automations");
    return row.name;
  });
}

/** Manual re-run of the follow-up processor for this organization. */
export async function runDueFollowUpsAction() {
  return act("runDueFollowUps", async () => {
    const { ctx } = await requireOrgContext();
    const r = await processDueFollowUps(ctx.db, { organizationId: ctx.organizationId });
    revalidatePath("/automations");
    revalidatePath("/overview");
    return r.claimed === 0 ? "Nothing is due right now." : `Processed ${r.claimed}: ${r.sent} sent, ${r.cancelled} stopped, ${r.rescheduled} rescheduled, ${r.failed} failed.`;
  });
}
