import { and, desc, eq, isNull, or } from "drizzle-orm";
import { notifications, type Notification } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import type { Priority } from "@/types/domain";
import { emitOutboundEvent } from "@/lib/integrations/n8n";

export interface NotifyInput {
  leadId: string | null;
  type: string;
  priority: Priority;
  title: string;
  body?: string;
  userId?: string | null;
}

export async function notifyOwner(ctx: OrgContext, input: NotifyInput): Promise<Notification> {
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      organizationId: ctx.organizationId,
      userId: input.userId ?? null,
      leadId: input.leadId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      body: input.body ?? null,
    })
    .returning();
  // Fan-out (SMS to the owner's phone, Slack, email) is delegated to n8n.
  void emitOutboundEvent("notification.created", ctx.organizationId, {
    notificationId: row.id,
    leadId: input.leadId,
    type: input.type,
    priority: input.priority,
    title: input.title,
    body: input.body ?? null,
  });
  return row;
}

export async function listNotifications(ctx: OrgContext, userId: string | null, limit = 20) {
  return ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, ctx.organizationId), userId ? or(isNull(notifications.userId), eq(notifications.userId, userId)) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markAllNotificationsRead(ctx: OrgContext) {
  await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.organizationId, ctx.organizationId), isNull(notifications.readAt)));
}
