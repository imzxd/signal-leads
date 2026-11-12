import { and, desc, eq, gte, notInArray, or, sql } from "drizzle-orm";
import { conversations, leads, type Lead } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { recordInboundMessage, getPrimaryConversation } from "@/server/repositories/conversations";
import { recordEvent } from "@/server/repositories/events";
import { grantConsent } from "@/lib/messaging/consent";
import { normalizePhone } from "@/ai/agents/shared/text-signals";
import { emitOutboundEvent } from "@/lib/integrations/n8n";
import type { LeadSubmission } from "@/features/leads/intake-schema";
import type { ContactChannel, LeadSource } from "@/types/domain";
import { SOURCE_LABELS } from "@/types/domain";

export interface IntakeMeta {
  source: LeadSource;
  ipAddress?: string | null;
  consentText?: string;
  providerMessageId?: string | null;
}

export interface IntakeResult {
  leadId: string;
  messageId: string;
  /** false when the contact matched an open lead and the message was threaded into it. */
  isNew: boolean;
}

const DEDUPE_WINDOW_DAYS = 30;

/** Find an open lead for the same person so repeat inquiries thread into one conversation. */
async function findOpenLead(ctx: OrgContext, email: string | undefined, phone: string | undefined): Promise<Lead | null> {
  const matchers = [email ? sql`lower(${leads.email}) = ${email.toLowerCase()}` : undefined, phone ? eq(leads.phone, phone) : undefined].filter(Boolean);
  if (!matchers.length) return null;
  const [lead] = await ctx.db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, ctx.organizationId),
        or(...matchers),
        notInArray(leads.stage, ["won", "lost", "archived"]),
        gte(leads.createdAt, new Date(Date.now() - DEDUPE_WINDOW_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead ?? null;
}

export async function createInboundLead(ctx: OrgContext, input: LeadSubmission, meta: IntakeMeta): Promise<IntakeResult> {
  const phone = input.phone ? normalizePhone(input.phone) : undefined;
  const channels: ContactChannel[] = input.consent ? (["web", input.email ? "email" : null, phone ? "sms" : null].filter(Boolean) as ContactChannel[]) : [];

  const existing = await findOpenLead(ctx, input.email, phone);
  if (existing) {
    const conversation = await getPrimaryConversation(ctx, existing);
    const message = await recordInboundMessage(ctx, { lead: existing, conversation, body: input.message, channel: "web", providerMessageId: meta.providerMessageId, metadata: { source: meta.source } });
    if (channels.length) await grantConsent(ctx, existing.id, channels, `${meta.source}_resubmission`, meta.consentText ?? null, meta.ipAddress ?? null);
    return { leadId: existing.id, messageId: message.id, isNew: false };
  }

  const [lead] = await ctx.db
    .insert(leads)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      email: input.email ?? null,
      phone: phone ?? null,
      company: input.company ?? null,
      serviceRequested: input.service ?? null,
      source: meta.source,
      preferredChannel: input.preferredChannel,
      stage: "new",
    })
    .returning();
  const [conversation] = await ctx.db
    .insert(conversations)
    .values({ organizationId: ctx.organizationId, leadId: lead.id, channel: input.preferredChannel === "sms" ? "sms" : "web", subject: input.service ?? "New inquiry" })
    .returning();
  const message = await recordInboundMessage(ctx, { lead, conversation, body: input.message, channel: "web", providerMessageId: meta.providerMessageId, metadata: { source: meta.source } });
  if (channels.length) await grantConsent(ctx, lead.id, channels, `${meta.source}_checkbox`, meta.consentText ?? null, meta.ipAddress ?? null);

  await recordEvent(ctx, {
    leadId: lead.id,
    type: "lead_received",
    actor: "lead",
    actorLabel: input.name,
    title: `Lead received via ${SOURCE_LABELS[meta.source].toLowerCase()}`,
    detail: input.message,
    receipt: { headline: input.consent ? "Consent captured for automated replies" : "No messaging consent — automation will not contact this lead", reasons: channels.map((c) => `Consent: ${c}`) },
  });
  void emitOutboundEvent("lead.created", ctx.organizationId, { leadId: lead.id, source: meta.source });
  return { leadId: lead.id, messageId: message.id, isNew: true };
}

/** Inbound message from a channel webhook (SMS, email, n8n) for an existing or new contact. */
export async function recordChannelReply(
  ctx: OrgContext,
  input: { from: { email?: string; phone?: string; name?: string }; body: string; channel: "sms" | "email" | "web"; providerMessageId?: string | null },
): Promise<IntakeResult> {
  const phone = input.from.phone ? normalizePhone(input.from.phone) : undefined;
  const existing = await findOpenLead(ctx, input.from.email, phone);
  if (existing) {
    const conversation = await getPrimaryConversation(ctx, existing);
    const message = await recordInboundMessage(ctx, { lead: existing, conversation, body: input.body, channel: input.channel, providerMessageId: input.providerMessageId });
    // Messaging us on a channel is consent to receive replies on it.
    if (input.channel !== "web") await grantConsent(ctx, existing.id, [input.channel], "inbound_message", null);
    return { leadId: existing.id, messageId: message.id, isNew: false };
  }
  return createInboundLead(
    ctx,
    {
      name: input.from.name ?? input.from.email ?? phone ?? "Unknown",
      email: input.from.email,
      phone,
      message: input.body,
      preferredChannel: input.channel === "sms" ? "sms" : "email",
      consent: true,
      company: undefined,
      service: undefined,
      website: undefined,
    },
    { source: input.channel === "sms" ? "sms" : "email", providerMessageId: input.providerMessageId, consentText: "Customer initiated contact on this channel" },
  );
}
