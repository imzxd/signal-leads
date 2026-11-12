import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { followUps, type FollowUp, type Lead } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { systemContext, type OrgContext } from "@/server/context";
import { getSettings, toBusinessProfile } from "@/server/repositories/settings";
import { getLead, updateLead } from "@/server/repositories/leads";
import { lastOutbound, listMessages } from "@/server/repositories/conversations";
import { recordEvent } from "@/server/repositories/events";
import { followUpAutomationKey, recordAutomationRun } from "@/server/repositories/automations";
import { sendMessage } from "@/lib/messaging/outbound";
import { BLOCK_REASON_LABELS } from "@/lib/messaging/outbound";
import { runAgent } from "@/ai/runtime/run-agent";
import { followUpAgent } from "@/ai/agents/follow-up/agent";
import { firstName } from "@/ai/agents/shared/text-signals";
import { followUpStopReason, STOP_REASON_LABELS } from "@/features/follow-ups/stop-conditions";
import { logger } from "@/lib/observability/logger";

const STALE_LOCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

/**
 * Schedule the configured sequence (+24h, +72h, +7d by default) relative to the message
 * we're waiting on. Keys are derived from that anchor message, so scheduling twice is a no-op.
 */
export async function scheduleFollowUpSequence(
  ctx: OrgContext,
  lead: Lead,
  conversationId: string,
  anchorMessageId: string,
  anchorAt: Date,
): Promise<FollowUp[]> {
  const settings = await getSettings(ctx);
  const channel = lead.preferredChannel;
  const rows = settings.followUpSequence.map((step, i) => ({
    organizationId: ctx.organizationId,
    leadId: lead.id,
    conversationId,
    channel,
    scheduledFor: new Date(anchorAt.getTime() + step.delayHours * 3600_000),
    sequenceNumber: i + 1,
    strategy: step.strategy,
    idempotencyKey: `fu:${anchorMessageId}:${i + 1}`,
  }));
  if (!rows.length) return [];
  return ctx.db.insert(followUps).values(rows).onConflictDoNothing().returning();
}

export async function cancelPendingFollowUps(ctx: OrgContext, leadId: string, reason: string): Promise<number> {
  const cancelled = await ctx.db
    .update(followUps)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, lockedAt: null })
    .where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.leadId, leadId), eq(followUps.status, "scheduled")))
    .returning({ id: followUps.id });
  return cancelled.length;
}

export async function listFollowUps(ctx: OrgContext, leadId: string) {
  return ctx.db
    .select()
    .from(followUps)
    .where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.leadId, leadId)))
    .orderBy(asc(followUps.scheduledFor));
}

export interface ProcessResult {
  claimed: number;
  sent: number;
  cancelled: number;
  rescheduled: number;
  failed: number;
}

/**
 * Restart-safe processor. Claims due rows atomically (scheduled → processing). Rows stuck in
 * `processing` (worker crashed) are reclaimed after 5 minutes; because the outbound service
 * deduplicates on the follow-up's idempotency key, a reclaimed row can never double-send.
 */
export async function processDueFollowUps(db: Database, opts: { now?: Date; organizationId?: string; limit?: number; leadId?: string } = {}): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const due = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        or(and(eq(followUps.status, "scheduled"), lte(followUps.scheduledFor, now)), and(eq(followUps.status, "processing"), lte(followUps.lockedAt, staleBefore))),
        opts.organizationId ? eq(followUps.organizationId, opts.organizationId) : undefined,
        opts.leadId ? eq(followUps.leadId, opts.leadId) : undefined,
      ),
    )
    .orderBy(asc(followUps.scheduledFor))
    .limit(opts.limit ?? 50);

  const result: ProcessResult = { claimed: 0, sent: 0, cancelled: 0, rescheduled: 0, failed: 0 };
  if (!due.length) return result;

  // Conditional update = atomic claim; a concurrent worker that loses the race gets no row back.
  const claimed = await db
    .update(followUps)
    .set({ status: "processing", lockedAt: now, attempts: sql`${followUps.attempts} + 1` })
    .where(
      and(
        inArray(followUps.id, due.map((d) => d.id)),
        or(eq(followUps.status, "scheduled"), and(eq(followUps.status, "processing"), lte(followUps.lockedAt, staleBefore))),
      ),
    )
    .returning();
  result.claimed = claimed.length;

  for (const fu of claimed) {
    try {
      const outcome = await processOne(systemContext(db, fu.organizationId, "Follow-Up Agent"), fu, now);
      result[outcome]++;
    } catch (e) {
      result.failed++;
      const error = e instanceof Error ? e.message : String(e);
      logger.error("follow_up.process_failed", { followUpId: fu.id, error });
      await db
        .update(followUps)
        .set(fu.attempts >= MAX_ATTEMPTS ? { status: "failed", lastError: error, lockedAt: null } : { status: "scheduled", lastError: error, lockedAt: null, scheduledFor: new Date(now.getTime() + 15 * 60_000) })
        .where(eq(followUps.id, fu.id));
    }
  }
  return result;
}

async function processOne(ctx: OrgContext, fu: FollowUp, now: Date): Promise<"sent" | "cancelled" | "rescheduled" | "failed"> {
  const settings = await getSettings(ctx);
  const lead = await getLead(ctx, fu.leadId);
  const automationKey = followUpAutomationKey(fu.sequenceNumber);

  const stop = followUpStopReason(lead, fu, settings.followUpSequence.length);
  if (stop) {
    await ctx.db.update(followUps).set({ status: "cancelled", cancelledAt: now, cancelReason: stop, lockedAt: null }).where(eq(followUps.id, fu.id));
    await recordAutomationRun(ctx, automationKey, lead.id, "skipped", STOP_REASON_LABELS[stop]);
    return "cancelled";
  }

  const msgs = await listMessages(ctx, lead.id);
  const step = settings.followUpSequence[fu.sequenceNumber - 1];
  const pendingKey = lead.automationState.pendingField;
  const pendingQuestion = pendingKey ? settings.qualificationFields.find((f) => f.key === pendingKey)?.question ?? null : null;

  const draft = await runAgent(
    followUpAgent,
    {
      business: toBusinessProfile(settings),
      channel: fu.channel,
      strategy: (step?.strategy ?? fu.strategy) as never,
      template: step?.template ?? null,
      sequenceNumber: fu.sequenceNumber,
      totalSteps: settings.followUpSequence.length,
      leadFirstName: firstName(lead.name),
      serviceRequested: lead.serviceRequested,
      pendingQuestion,
      lastOutboundMessage: lastOutbound(msgs)?.body ?? null,
    },
    { db: ctx.db, organizationId: ctx.organizationId, leadId: lead.id },
  );

  const send = await sendMessage(ctx, {
    leadId: lead.id,
    body: draft.output.message,
    authorType: "ai",
    automationKey,
    idempotencyKey: fu.idempotencyKey,
    respectMessagingHours: true,
    messagingHours: settings.messagingHours,
    timeZone: settings.organization.timezone,
    channel: fu.channel,
    metadata: { followUpId: fu.id, sequenceNumber: fu.sequenceNumber, agentRunId: draft.runId },
    now,
  });

  if (send.status === "blocked") {
    if (send.reason === "outside_messaging_hours" && send.retryAt) {
      await ctx.db.update(followUps).set({ status: "scheduled", scheduledFor: send.retryAt, lockedAt: null }).where(eq(followUps.id, fu.id));
      return "rescheduled";
    }
    await ctx.db.update(followUps).set({ status: "cancelled", cancelledAt: now, cancelReason: send.reason, lockedAt: null }).where(eq(followUps.id, fu.id));
    await recordEvent(ctx, {
      leadId: lead.id,
      type: "follow_up_cancelled",
      actor: "system",
      actorLabel: "Message safety",
      title: `Follow-up ${fu.sequenceNumber} not sent`,
      detail: BLOCK_REASON_LABELS[send.reason],
    });
    await recordAutomationRun(ctx, automationKey, lead.id, "skipped", BLOCK_REASON_LABELS[send.reason]);
    return "cancelled";
  }

  if (send.status === "failed") {
    const final = fu.attempts >= MAX_ATTEMPTS;
    await ctx.db
      .update(followUps)
      .set(final ? { status: "failed", lastError: send.error, lockedAt: null } : { status: "scheduled", lastError: send.error, lockedAt: null, scheduledFor: new Date(now.getTime() + 15 * 60_000) })
      .where(eq(followUps.id, fu.id));
    await recordAutomationRun(ctx, automationKey, lead.id, "failed", undefined, send.error);
    if (final) {
      await recordEvent(ctx, { leadId: lead.id, type: "message_failed", actor: "system", actorLabel: "Messaging", title: `Follow-up ${fu.sequenceNumber} failed to send`, detail: send.error });
    }
    return "failed";
  }

  if (send.status === "duplicate" && send.message.status === "sending") {
    // A previous worker crashed mid-send. We cannot know if the provider delivered it,
    // so we never resend automatically — surface it for a human instead.
    await ctx.db
      .update(followUps)
      .set({ status: "failed", lastError: "Delivery was interrupted; not retried to avoid a duplicate message.", lockedAt: null, messageId: send.message.id })
      .where(eq(followUps.id, fu.id));
    return "failed";
  }

  await ctx.db.update(followUps).set({ status: "sent", executedAt: now, messageId: send.message.id, lockedAt: null, lastError: null }).where(eq(followUps.id, fu.id));
  if (send.status !== "duplicate") {
    const remaining = settings.followUpSequence.length - fu.sequenceNumber;
    await updateLead(ctx, lead.id, {
      nextAction: remaining > 0 ? `Follow-up ${fu.sequenceNumber + 1} scheduled` : "Sequence finished — awaiting reply",
    });
    await recordEvent(ctx, {
      leadId: lead.id,
      type: "follow_up_sent",
      actor: "agent",
      actorLabel: "Follow-Up Agent",
      title: `Follow-up ${fu.sequenceNumber} sent`,
      detail: draft.output.message,
      agentRunId: draft.runId,
      receipt: {
        headline: `Follow-up ${fu.sequenceNumber} of ${settings.followUpSequence.length}`,
        reasons: ["No reply since our last message", "Consent on file", "Autopilot on"],
        nextAction: remaining > 0 ? `Next follow-up in sequence` : "Stop sequence",
        fallback: draft.fellBack,
      },
    });
    await recordAutomationRun(ctx, automationKey, lead.id, "succeeded", `Sent via ${fu.channel}`);
  }
  return "sent";
}

/** Demo helper: make the next pending follow-up for a lead due now and process it. */
export async function sendNextFollowUpNow(ctx: OrgContext, leadId: string): Promise<ProcessResult> {
  const [next] = await ctx.db
    .select()
    .from(followUps)
    .where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.leadId, leadId), eq(followUps.status, "scheduled")))
    .orderBy(asc(followUps.scheduledFor))
    .limit(1);
  if (!next) return { claimed: 0, sent: 0, cancelled: 0, rescheduled: 0, failed: 0 };
  const now = new Date();
  await ctx.db.update(followUps).set({ scheduledFor: now }).where(eq(followUps.id, next.id));
  return processDueFollowUps(ctx.db, { now, organizationId: ctx.organizationId, leadId });
}

/** Leads whose follow-ups are all done — used by analytics and the "recovered" metric. */
export async function leadHadSentFollowUpSince(ctx: OrgContext, leadId: string, since: Date | null): Promise<number> {
  const rows = await ctx.db
    .select({ seq: followUps.sequenceNumber, executedAt: followUps.executedAt })
    .from(followUps)
    .where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.leadId, leadId), eq(followUps.status, "sent")));
  const relevant = rows.filter((r) => r.executedAt && (!since || r.executedAt > since));
  return relevant.length ? Math.max(...relevant.map((r) => r.seq)) : 0;
}
