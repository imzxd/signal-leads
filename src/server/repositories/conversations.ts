import { and, asc, desc, eq, sql } from "drizzle-orm";
import { conversations, leads, messages, type Conversation, type Lead, type Message } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import type { ConversationChannel } from "@/types/domain";
import { truncate } from "@/ai/agents/shared/text-signals";

export async function getPrimaryConversation(ctx: OrgContext, lead: Lead): Promise<Conversation> {
  const [existing] = await ctx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.leadId, lead.id), eq(conversations.organizationId, ctx.organizationId)))
    .orderBy(asc(conversations.createdAt))
    .limit(1);
  if (existing) return existing;
  const channel: ConversationChannel = lead.preferredChannel === "sms" ? "sms" : lead.preferredChannel === "email" ? "email" : "web";
  const [created] = await ctx.db
    .insert(conversations)
    .values({ organizationId: ctx.organizationId, leadId: lead.id, channel, subject: lead.serviceRequested ?? "New inquiry" })
    .returning();
  return created;
}

export async function listMessages(ctx: OrgContext, leadId: string, limit = 200): Promise<Message[]> {
  return ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.organizationId, ctx.organizationId)))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

export async function getMessage(ctx: OrgContext, messageId: string): Promise<Message | null> {
  const [m] = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, ctx.organizationId)))
    .limit(1);
  return m ?? null;
}

export async function recordInboundMessage(
  ctx: OrgContext,
  input: { lead: Lead; conversation: Conversation; body: string; channel: string; providerMessageId?: string | null; metadata?: Record<string, unknown> },
): Promise<Message> {
  const now = new Date();
  const [msg] = await ctx.db
    .insert(messages)
    .values({
      organizationId: ctx.organizationId,
      conversationId: input.conversation.id,
      leadId: input.lead.id,
      direction: "inbound",
      authorType: "lead",
      channel: input.channel,
      body: input.body.slice(0, 5000),
      status: "received",
      providerMessageId: input.providerMessageId ?? null,
      // Provider message ids make inbound webhooks idempotent (Twilio/n8n retries).
      idempotencyKey: input.providerMessageId ? `in:${input.channel}:${input.providerMessageId}` : null,
      metadata: input.metadata ?? {},
    })
    .returning();
  await ctx.db
    .update(conversations)
    .set({ lastMessageAt: now, unreadCount: sql`${conversations.unreadCount} + 1` })
    .where(eq(conversations.id, input.conversation.id));
  await ctx.db
    .update(leads)
    .set({ lastInboundAt: now, lastContactAt: now })
    .where(and(eq(leads.id, input.lead.id), eq(leads.organizationId, ctx.organizationId)));
  return msg;
}

export async function addInternalNote(ctx: OrgContext, lead: Lead, body: string, authorId: string | null): Promise<Message> {
  const conversation = await getPrimaryConversation(ctx, lead);
  const [msg] = await ctx.db
    .insert(messages)
    .values({
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: lead.id,
      direction: "internal",
      authorType: "staff",
      authorId,
      channel: "internal",
      body: body.slice(0, 5000),
      status: "sent",
    })
    .returning();
  return msg;
}

/** Compact transcript for prompts — only the most recent, relevant turns. */
export function transcriptExcerpt(msgs: Message[], businessName: string, maxMessages = 8): string {
  return msgs
    .filter((m) => m.direction !== "internal" && m.status !== "blocked" && m.status !== "failed")
    .slice(-maxMessages)
    .map((m) => `${m.direction === "inbound" ? "Customer" : businessName}: ${truncate(m.body.replace(/\s+/g, " "), 500)}`)
    .join("\n");
}

export function lastOutbound(msgs: Message[]): Message | null {
  return [...msgs].reverse().find((m) => m.direction === "outbound" && (m.status === "sent" || m.status === "simulated" || m.status === "delivered")) ?? null;
}

export async function markConversationRead(ctx: OrgContext, conversationId: string) {
  await ctx.db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, ctx.organizationId)));
}

export async function latestConversations(ctx: OrgContext, limit = 60) {
  return ctx.db
    .select({ conversation: conversations, lead: leads })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(eq(conversations.organizationId, ctx.organizationId))
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
    .limit(limit);
}
