/**
 * Agent tools: the narrow, validated, org-scoped operations automation is allowed to perform.
 * Agents themselves are pure decision functions; the orchestrator executes their decisions
 * exclusively through these tools. Each tool validates input, runs inside the caller's
 * OrgContext (organization derived from auth — never from tool input), logs, and returns a
 * structured result instead of throwing.
 */
import { z } from "zod";
import type { OrgContext } from "@/server/context";
import { getLead, updateLead, upsertCustomFields } from "@/server/repositories/leads";
import { getSettings } from "@/server/repositories/settings";
import { searchKnowledge as searchKnowledgeRepo } from "@/server/repositories/knowledge";
import { createAppointment as createAppointmentRepo, getAvailableSlots } from "@/server/repositories/appointments";
import { cancelPendingFollowUps, scheduleFollowUpSequence } from "@/server/jobs/follow-ups";
import { notifyOwner as notifyOwnerRepo } from "@/server/repositories/notifications";
import { canSendMessage as canSendCheck, sendMessage as sendMessageService } from "@/lib/messaging/outbound";
import { AUTOMATION_KEYS, type AutomationKey } from "@/server/repositories/automations";
import { CONTACT_CHANNELS, LEAD_STAGES, PRIORITIES, TEMPERATURES, URGENCIES } from "@/types/domain";
import { logger } from "@/lib/observability/logger";
import { emitOutboundEvent } from "@/lib/integrations/n8n";

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

function defineTool<S extends z.ZodType, R>(name: string, schema: S, handler: (ctx: OrgContext, input: z.infer<S>) => Promise<R>) {
  return async (ctx: OrgContext, input: z.input<S>): Promise<ToolResult<R>> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      logger.warn("tool.invalid_input", { tool: name, issue: parsed.error.issues[0]?.message });
      return { ok: false, error: `Invalid input for ${name}: ${parsed.error.issues[0]?.message}` };
    }
    const started = Date.now();
    try {
      const data = await handler(ctx, parsed.data);
      logger.debug("tool.executed", { tool: name, org: ctx.organizationId, ms: Date.now() - started });
      return { ok: true, data };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error("tool.failed", { tool: name, org: ctx.organizationId, error });
      return { ok: false, error };
    }
  };
}

/** Unwrap a tool result inside workflows where failure must abort the step. */
export function must<T>(r: ToolResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const uuid = z.string().uuid();
const automationKey = z.enum(Object.values(AUTOMATION_KEYS) as [AutomationKey, ...AutomationKey[]]);

/** Lead columns automation may change. Identity, tenancy and timestamps are not writable. */
const leadPatch = z
  .object({
    name: z.string().max(120).nullable(),
    email: z.string().email().max(200).nullable(),
    phone: z.string().max(40).nullable(),
    company: z.string().max(160).nullable(),
    serviceKey: z.string().max(64).nullable(),
    serviceRequested: z.string().max(160).nullable(),
    intent: z.string().max(80).nullable(),
    urgency: z.enum(URGENCIES),
    timeline: z.string().max(120).nullable(),
    budget: z.string().max(80).nullable(),
    location: z.string().max(120).nullable(),
    address: z.string().max(240).nullable(),
    summary: z.string().max(600).nullable(),
    stage: z.enum(LEAD_STAGES),
    score: z.number().int().min(0).max(100),
    temperature: z.enum(TEMPERATURES),
    estimatedValue: z.number().min(0).nullable(),
    missingFields: z.array(z.string()),
    qualificationComplete: z.boolean(),
    nextAction: z.string().max(200).nullable(),
    nextActionAt: z.date().nullable(),
    aiConfidence: z.number().min(0).max(1).nullable(),
    isSpam: z.boolean(),
    isExistingCustomer: z.boolean(),
    bookingState: z.record(z.string(), z.unknown()),
    automationState: z.record(z.string(), z.unknown()),
    handoff: z.record(z.string(), z.unknown()).nullable(),
    optedOutAt: z.date().nullable(),
    recoveredAt: z.date().nullable(),
    lostAt: z.date().nullable(),
    lostReason: z.string().max(200).nullable(),
  })
  .partial();

export const tools = {
  getLead: defineTool("getLead", z.object({ leadId: uuid }), (ctx, i) => getLead(ctx, i.leadId)),

  updateLeadFields: defineTool(
    "updateLeadFields",
    z.object({
      leadId: uuid,
      patch: leadPatch,
      customFields: z.array(z.object({ key: z.string(), value: z.string(), confidence: z.number().nullable().optional() })).optional(),
      source: z.enum(["ai", "staff", "form", "api"]).default("ai"),
    }),
    async (ctx, i) => {
      if (i.customFields?.length) await upsertCustomFields(ctx, i.leadId, i.customFields.map((f) => ({ ...f, source: i.source })));
      return updateLead(ctx, i.leadId, i.patch as never);
    },
  ),

  getBusinessRules: defineTool("getBusinessRules", z.object({}), (ctx) => getSettings(ctx)),

  getServiceArea: defineTool("getServiceArea", z.object({}), async (ctx) => (await getSettings(ctx)).serviceArea),

  searchKnowledge: defineTool("searchKnowledge", z.object({ query: z.string().min(2).max(1000), k: z.number().int().min(1).max(8).default(4) }), (ctx, i) =>
    searchKnowledgeRepo(ctx, i.query, i.k),
  ),

  getAvailableAppointments: defineTool("getAvailableAppointments", z.object({ limit: z.number().int().min(1).max(6).optional() }), async (ctx, i) =>
    getAvailableSlots(ctx, await getSettings(ctx), { limit: i.limit }),
  ),

  createAppointment: defineTool(
    "createAppointment",
    z.object({ leadId: uuid, startsAt: z.string().datetime(), endsAt: z.string().datetime(), createdBy: z.enum(["agent", "staff"]), notes: z.string().max(1000).nullable().optional() }),
    async (ctx, i) => {
      const settings = await getSettings(ctx);
      const lead = await getLead(ctx, i.leadId);
      const appt = await createAppointmentRepo(ctx, settings, lead, { startsAt: i.startsAt, endsAt: i.endsAt }, i.createdBy, i.notes);
      void emitOutboundEvent("appointment.created", ctx.organizationId, { leadId: lead.id, appointmentId: appt.id, startsAt: appt.startsAt.toISOString() });
      return appt;
    },
  ),

  scheduleFollowUp: defineTool(
    "scheduleFollowUp",
    z.object({ leadId: uuid, conversationId: uuid, anchorMessageId: uuid, anchorAt: z.date() }),
    async (ctx, i) => scheduleFollowUpSequence(ctx, await getLead(ctx, i.leadId), i.conversationId, i.anchorMessageId, i.anchorAt),
  ),

  cancelFollowUps: defineTool("cancelFollowUps", z.object({ leadId: uuid, reason: z.string().max(80) }), (ctx, i) => cancelPendingFollowUps(ctx, i.leadId, i.reason)),

  notifyOwner: defineTool(
    "notifyOwner",
    z.object({ leadId: uuid.nullable(), type: z.string().max(60), priority: z.enum(PRIORITIES), title: z.string().max(160), body: z.string().max(1000).optional() }),
    (ctx, i) => notifyOwnerRepo(ctx, i),
  ),

  canSendMessage: defineTool(
    "canSendMessage",
    z.object({ leadId: uuid, authorType: z.enum(["ai", "staff", "system"]), automationKey: automationKey.nullable().optional(), channel: z.enum(CONTACT_CHANNELS).optional() }),
    async (ctx, i) => canSendCheck(ctx, await getLead(ctx, i.leadId), i),
  ),

  sendMessage: defineTool(
    "sendMessage",
    z.object({
      leadId: uuid,
      body: z.string().min(1).max(4000),
      authorType: z.enum(["ai", "staff", "system"]),
      authorId: uuid.nullable().optional(),
      automationKey: automationKey.nullable().optional(),
      idempotencyKey: z.string().min(8).max(200),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    (ctx, i) => sendMessageService(ctx, i),
  ),

  requestHumanHandoff: defineTool(
    "requestHumanHandoff",
    z.object({ leadId: uuid, priority: z.enum(PRIORITIES), reason: z.string().max(200), ownerSummary: z.string().max(1000) }),
    async (ctx, i) => {
      await cancelPendingFollowUps(ctx, i.leadId, "needs_human");
      const lead = await updateLead(ctx, i.leadId, {
        stage: "needs_human",
        nextAction: "Reply personally",
        handoff: { required: true, priority: i.priority, reason: i.reason, ownerSummary: i.ownerSummary, requestedAt: new Date().toISOString() },
      });
      await notifyOwnerRepo(ctx, { leadId: i.leadId, type: "handoff", priority: i.priority, title: `Needs you: ${lead.name ?? "New lead"} — ${i.reason}`, body: i.ownerSummary });
      void emitOutboundEvent("lead.handoff_requested", ctx.organizationId, { leadId: i.leadId, priority: i.priority, reason: i.reason });
      return lead;
    },
  ),
};

export type Tools = typeof tools;
