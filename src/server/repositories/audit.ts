import { auditLogs } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { logger, sanitize } from "@/lib/observability/logger";

/** Append-only audit trail for security-relevant and staff-initiated operations. */
export async function audit(ctx: OrgContext, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  try {
    await ctx.db.insert(auditLogs).values({
      organizationId: ctx.organizationId,
      actorUserId: ctx.actor.kind === "staff" ? ctx.actor.userId : null,
      action,
      entityType,
      entityId,
      metadata: { ...(sanitize(metadata) as Record<string, unknown>), actor: ctx.actor.kind },
    });
  } catch (e) {
    logger.error("audit.write_failed", { action, error: e instanceof Error ? e.message : String(e) });
  }
}
