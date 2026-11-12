import { and, eq } from "drizzle-orm";
import { conversations, leads, messages, organizations, type Lead, type Message } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { getLead } from "@/server/repositories/leads";
import { getPrimaryConversation } from "@/server/repositories/conversations";
import { isAutomationEnabled, type AutomationKey } from "@/server/repositories/automations";
import { TERMINAL_STAGES, type ContactChannel, type MessagingHours } from "@/types/domain";
import { logger } from "@/lib/observability/logger";
import { hasConsent } from "./consent";
import { getChannelAdapter } from "./channels";
import { nextAllowedSendTime } from "./messaging-hours";

export type BlockReason =
  | "organization_inactive"
  | "opted_out"
  | "no_consent"
  | "human_takeover"
  | "autopilot_paused"
  | "automation_disabled"
  | "outside_messaging_hours"
  | "no_contact_address"
  | "lead_closed";

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  organization_inactive: "Organization is not active",
  opted_out: "Lead opted out",
  no_consent: "No consent for this channel",
  human_takeover: "A team member has taken over",
  autopilot_paused: "Autopilot is paused for this lead",
  automation_disabled: "This automation is turned off",
  outside_messaging_hours: "Outside allowed messaging hours",
  no_contact_address: "No contact address for this channel",
  lead_closed: "Lead is closed (won, lost or archived)",
};

export interface SendRequest {
  leadId: string;
  body: string;
  authorType: "ai" | "staff" | "system";
  authorId?: string | null;
  /** Required for automated sends; the automation must be enabled. */
  automationKey?: AutomationKey | null;
  /** Stable key — the same logical message is never sent twice. */
  idempotencyKey: string;
  /** Automated follow-ups respect messaging hours; replies to an inbound message do not. */
  respectMessagingHours?: boolean;
  messagingHours?: MessagingHours;
  timeZone?: string;
  channel?: ContactChannel;
  subject?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export type SendResult =
  | { status: "sent" | "simulated"; message: Message }
  | { status: "duplicate"; message: Message }
  | { status: "blocked"; reason: BlockReason; retryAt?: Date; message: Message | null }
  | { status: "failed"; error: string; message: Message };

export interface SendCheck {
  allowed: boolean;
  reason?: BlockReason;
  retryAt?: Date;
}

/** Every safety check in one place. Pure reads — safe to call for previews. */
export async function canSendMessage(ctx: OrgContext, lead: Lead, req: Omit<SendRequest, "leadId" | "body" | "idempotencyKey">): Promise<SendCheck> {
  const [org] = await ctx.db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!org || org.status !== "active") return { allowed: false, reason: "organization_inactive" };
  if (lead.optedOutAt) return { allowed: false, reason: "opted_out" };
  const automated = req.authorType !== "staff";
  if (automated && (TERMINAL_STAGES as readonly string[]).includes(lead.stage)) return { allowed: false, reason: "lead_closed" };
  if (automated && lead.controlMode === "human") return { allowed: false, reason: "human_takeover" };
  if (automated && lead.controlMode === "paused") return { allowed: false, reason: "autopilot_paused" };
  const channel = req.channel ?? lead.preferredChannel;
  if (channel === "email" && !lead.email) return { allowed: false, reason: "no_contact_address" };
  if (channel === "sms" && !lead.phone) return { allowed: false, reason: "no_contact_address" };
  if (!(await hasConsent(ctx, lead.id, channel))) return { allowed: false, reason: "no_consent" };
  if (automated && req.automationKey && !(await isAutomationEnabled(ctx, req.automationKey))) return { allowed: false, reason: "automation_disabled" };
  if (automated && req.respectMessagingHours && req.messagingHours) {
    const retryAt = nextAllowedSendTime(req.now ?? new Date(), req.messagingHours, req.timeZone ?? "America/Toronto");
    if (retryAt) return { allowed: false, reason: "outside_messaging_hours", retryAt };
  }
  return { allowed: true };
}

/**
 * The ONLY way Signal Leads sends a message. Agents and staff actions both go through here.
 *
 * Idempotency: the message row is inserted with a unique (organization_id, idempotency_key)
 * BEFORE the provider call. A retry after a crash finds the existing row and never sends twice.
 */
export async function sendMessage(ctx: OrgContext, req: SendRequest): Promise<SendResult> {
  const lead = await getLead(ctx, req.leadId);
  const conversation = await getPrimaryConversation(ctx, lead);
  const channel = req.channel ?? lead.preferredChannel;

  const existing = await findByIdempotencyKey(ctx, req.idempotencyKey);
  if (existing && existing.status !== "blocked") return { status: "duplicate", message: existing };

  const check = await canSendMessage(ctx, lead, req);
  if (!check.allowed) {
    const [blocked] = await ctx.db
      .insert(messages)
      .values({
        organizationId: ctx.organizationId,
        conversationId: conversation.id,
        leadId: lead.id,
        direction: "outbound",
        authorType: req.authorType,
        authorId: req.authorId ?? null,
        channel,
        body: req.body,
        status: "blocked",
        blockReason: check.reason,
        metadata: req.metadata ?? {},
      })
      .returning();
    return { status: "blocked", reason: check.reason!, retryAt: check.retryAt, message: blocked };
  }

  const inserted = await ctx.db
    .insert(messages)
    .values({
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: lead.id,
      direction: "outbound",
      authorType: req.authorType,
      authorId: req.authorId ?? null,
      channel,
      body: req.body,
      status: "sending",
      idempotencyKey: req.idempotencyKey,
      metadata: req.metadata ?? {},
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    const dup = await findByIdempotencyKey(ctx, req.idempotencyKey);
    return { status: "duplicate", message: dup! };
  }
  const message = inserted[0];

  const [org] = await ctx.db.select({ isDemo: organizations.isDemo, name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const adapter = getChannelAdapter(channel, { isDemoOrg: Boolean(org?.isDemo) });
  const to = channel === "email" ? lead.email! : channel === "sms" ? lead.phone! : `web:${lead.id}`;
  try {
    const result = await adapter.send({ to, body: req.body, subject: req.subject, idempotencyKey: req.idempotencyKey, fromName: org?.name ?? "Signal Leads" });
    const now = new Date();
    const [updated] = await ctx.db
      .update(messages)
      .set({ status: result.status, provider: result.provider, providerMessageId: result.providerMessageId, sentAt: now })
      .where(eq(messages.id, message.id))
      .returning();
    await ctx.db
      .update(leads)
      .set({
        lastOutboundAt: now,
        lastContactAt: now,
        ...(lead.firstResponseAt ? {} : { firstResponseAt: now }),
        ...(lead.stage === "new" ? { stage: "contacted" as const } : {}),
      })
      .where(and(eq(leads.id, lead.id), eq(leads.organizationId, ctx.organizationId)));
    await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversation.id));
    return { status: result.status, message: updated };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("messaging.send_failed", { channel, provider: adapter.id, error });
    const [failed] = await ctx.db.update(messages).set({ status: "failed", provider: adapter.id, error }).where(eq(messages.id, message.id)).returning();
    return { status: "failed", error, message: failed };
  }
}

async function findByIdempotencyKey(ctx: OrgContext, key: string): Promise<Message | null> {
  const [row] = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}
