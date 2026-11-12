/**
 * Human control. Staff can always override automation; every change leaves an event and an
 * audit record. While a human has taken over, AI outbound communication is blocked by the
 * central messaging service.
 */
import { randomUUID } from "node:crypto";
import { leadScores, type Lead } from "@/server/db/schema";
import { actorLabel, ForbiddenError, type OrgContext } from "@/server/context";
import { getLead, updateLead } from "@/server/repositories/leads";
import { addInternalNote, listMessages, transcriptExcerpt } from "@/server/repositories/conversations";
import { recordEvent } from "@/server/repositories/events";
import { audit } from "@/server/repositories/audit";
import { cancelPendingFollowUps } from "@/server/jobs/follow-ups";
import { getSettings, toBusinessProfile } from "@/server/repositories/settings";
import { BLOCK_REASON_LABELS, sendMessage } from "@/lib/messaging/outbound";
import { emitOutboundEvent } from "@/lib/integrations/n8n";
import { temperatureForScore } from "@/features/leads/scoring/engine";
import { receipt } from "@/features/leads/receipts";
import { runAgent } from "@/ai/runtime/run-agent";
import { draftingAgent } from "@/ai/agents/drafting/agent";
import { firstName } from "@/ai/agents/shared/text-signals";
import { handleInboundMessage } from "@/ai/orchestrator";
import { STAGE_LABELS, type LeadStage } from "@/types/domain";

function staff(ctx: OrgContext) {
  if (ctx.actor.kind !== "staff") throw new ForbiddenError("Only team members can do this");
  return ctx.actor;
}

async function log(ctx: OrgContext, lead: Lead, type: Parameters<typeof recordEvent>[1]["type"], title: string, detail?: string) {
  await recordEvent(ctx, { leadId: lead.id, type, actor: "staff", actorLabel: actorLabel(ctx.actor), title, detail });
  await audit(ctx, `lead.${type}`, "lead", lead.id, { title });
}

export async function takeOver(ctx: OrgContext, leadId: string) {
  const s = staff(ctx);
  await cancelPendingFollowUps(ctx, leadId, "human_takeover");
  const lead = await updateLead(ctx, leadId, { controlMode: "human", assignedTo: s.userId, nextAction: "Team member is handling this lead" });
  await log(ctx, lead, "takeover", `${s.name} took over — AI messaging stopped`);
  return lead;
}

export async function returnToSignal(ctx: OrgContext, leadId: string) {
  staff(ctx);
  const before = await getLead(ctx, leadId);
  const lead = await updateLead(ctx, leadId, {
    controlMode: "autopilot",
    stage: before.stage === "needs_human" ? "qualifying" : before.stage,
    handoff: before.handoff ? { ...before.handoff, required: false, resolvedAt: new Date().toISOString() } : null,
  });
  await log(ctx, lead, "returned_to_signal", "Control returned to Signal — autopilot on");
  // Smooth hand-back: if the customer's last message is still unanswered, Signal picks it up now.
  const msgs = await listMessages(ctx, leadId);
  const last = [...msgs].reverse().find((m) => m.direction !== "internal");
  if (last && last.direction === "inbound") await handleInboundMessage(ctx, leadId, last.id);
  return getLead(ctx, leadId);
}

export async function pauseAutopilot(ctx: OrgContext, leadId: string) {
  staff(ctx);
  await cancelPendingFollowUps(ctx, leadId, "autopilot_paused");
  const lead = await updateLead(ctx, leadId, { controlMode: "paused" });
  await log(ctx, lead, "autopilot_paused", "Autopilot paused — follow-ups cancelled");
  return lead;
}

export async function resumeAutopilot(ctx: OrgContext, leadId: string) {
  return returnToSignal(ctx, leadId);
}

export async function markWon(ctx: OrgContext, leadId: string, value: number | null) {
  staff(ctx);
  await cancelPendingFollowUps(ctx, leadId, "converted");
  const before = await getLead(ctx, leadId);
  const wonValue = value ?? before.estimatedValue ?? null;
  const lead = await updateLead(ctx, leadId, { stage: "won", wonAt: new Date(), wonValue, nextAction: "Won — automation stopped", controlMode: before.controlMode === "autopilot" ? "autopilot" : before.controlMode });
  await recordEvent(ctx, {
    leadId,
    type: "converted",
    actor: "staff",
    actorLabel: actorLabel(ctx.actor),
    title: `Marked won${wonValue ? ` — $${wonValue.toLocaleString()}` : ""}`,
    receipt: receipt({ headline: "Conversion recorded", reasons: ["All follow-ups stopped", before.recoveredAt ? "Recovered by follow-up earlier" : "Converted from active pipeline"] }),
  });
  await audit(ctx, "lead.won", "lead", leadId, { wonValue });
  void emitOutboundEvent("lead.won", ctx.organizationId, { leadId, value: wonValue });
  return lead;
}

export async function markLost(ctx: OrgContext, leadId: string, reason: string) {
  staff(ctx);
  await cancelPendingFollowUps(ctx, leadId, "lost");
  const lead = await updateLead(ctx, leadId, { stage: "lost", lostAt: new Date(), lostReason: reason || "Not specified", nextAction: "Lost — automation stopped" });
  await log(ctx, lead, "lost", `Marked lost — ${reason || "no reason given"}`);
  void emitOutboundEvent("lead.lost", ctx.organizationId, { leadId, reason });
  return lead;
}

export async function changeStage(ctx: OrgContext, leadId: string, stage: LeadStage) {
  staff(ctx);
  const before = await getLead(ctx, leadId);
  if (before.stage === stage) return before;
  if (stage === "won") return markWon(ctx, leadId, null);
  if (stage === "lost") return markLost(ctx, leadId, "Moved to Lost on the pipeline");
  if (stage === "archived") await cancelPendingFollowUps(ctx, leadId, "archived");
  const lead = await updateLead(ctx, leadId, { stage, ...(before.stage === "won" ? { wonAt: null } : {}), ...(before.stage === "lost" ? { lostAt: null, lostReason: null } : {}) });
  await log(ctx, lead, "stage_changed", `Stage changed ${STAGE_LABELS[before.stage]} → ${STAGE_LABELS[stage]}`);
  return lead;
}

export async function overrideScore(ctx: OrgContext, leadId: string, score: number, reason: string) {
  staff(ctx);
  const before = await getLead(ctx, leadId);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const temperature = temperatureForScore(clamped);
  const lead = await updateLead(ctx, leadId, { score: clamped, temperature });
  await ctx.db.insert(leadScores).values({
    organizationId: ctx.organizationId,
    leadId,
    score: clamped,
    previousScore: before.score,
    temperature,
    factors: [{ key: "manual", label: `Manual override: ${reason || "staff judgement"}`, points: clamped - before.score, kind: clamped >= before.score ? "positive" : "negative" }],
    explanation: `Set manually by ${actorLabel(ctx.actor)}${reason ? `: ${reason}` : ""}.`,
    source: "manual",
  });
  await recordEvent(ctx, {
    leadId,
    type: "score_changed",
    actor: "staff",
    actorLabel: actorLabel(ctx.actor),
    title: `Score manually set ${before.score} → ${clamped}`,
    receipt: receipt({ headline: "Manual override", reasons: [reason || "Staff judgement"], scoreDelta: clamped - before.score }),
  });
  await audit(ctx, "lead.score_override", "lead", leadId, { from: before.score, to: clamped, reason });
  return lead;
}

export async function assignLead(ctx: OrgContext, leadId: string, userId: string | null, assigneeName: string | null) {
  staff(ctx);
  const lead = await updateLead(ctx, leadId, { assignedTo: userId });
  await log(ctx, lead, "assigned", userId ? `Assigned to ${assigneeName ?? "a team member"}` : "Unassigned");
  return lead;
}

/** Staff message: still passes consent/opt-out checks, but is allowed during takeover. */
export async function sendStaffMessage(ctx: OrgContext, leadId: string, body: string) {
  const s = staff(ctx);
  const lead = await getLead(ctx, leadId);
  const result = await sendMessage(ctx, { leadId, body, authorType: "staff", authorId: s.userId, idempotencyKey: `staff:${randomUUID()}` });
  if (result.status === "blocked") {
    await log(ctx, lead, "message_blocked", "Message not sent", BLOCK_REASON_LABELS[result.reason]);
    return { ok: false as const, error: BLOCK_REASON_LABELS[result.reason] };
  }
  if (result.status === "failed") return { ok: false as const, error: result.error };
  // A staff reply resolves the "waiting" state and stops the automated sequence.
  await cancelPendingFollowUps(ctx, leadId, "staff_replied");
  await updateLead(ctx, leadId, { nextAction: lead.controlMode === "human" ? "Team member is handling this lead" : "Waiting for the customer" });
  await recordEvent(ctx, { leadId, type: "message_sent", actor: "staff", actorLabel: s.name, title: `${s.name} sent a message`, detail: body });
  return { ok: true as const };
}

export async function addNote(ctx: OrgContext, leadId: string, body: string) {
  const s = staff(ctx);
  const lead = await getLead(ctx, leadId);
  await addInternalNote(ctx, lead, body, s.userId);
  await recordEvent(ctx, { leadId, type: "note", actor: "staff", actorLabel: s.name, title: "Internal note", detail: body });
}

/** "Request AI suggestion": drafts a reply for staff to review. Nothing is sent. */
export async function suggestReply(ctx: OrgContext, leadId: string): Promise<{ message: string; heuristic: boolean }> {
  staff(ctx);
  const settings = await getSettings(ctx);
  const lead = await getLead(ctx, leadId);
  const msgs = await listMessages(ctx, leadId);
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  const pendingKey = lead.automationState.pendingField;
  const out = await runAgent(
    draftingAgent,
    {
      business: toBusinessProfile(settings),
      purpose: "staff_suggestion",
      channel: lead.preferredChannel,
      leadFirstName: firstName(lead.name),
      serviceRequested: lead.serviceRequested,
      location: lead.location,
      urgency: lead.urgency,
      knowledgeAnswer: null,
      unansweredQuestion: null,
      nextQuestion: pendingKey ? settings.qualificationFields.find((f) => f.key === pendingKey)?.question ?? null : null,
      slots: [],
      appointmentLabel: null,
      lastCustomerMessage: lastInbound?.body ?? null,
      conversationExcerpt: transcriptExcerpt(msgs, settings.businessName, 10),
      includeOptOut: false,
    },
    { db: ctx.db, organizationId: ctx.organizationId, leadId },
  );
  await recordEvent(ctx, { leadId, type: "ai_suggestion", actor: "agent", actorLabel: "Drafting Assistant", title: "Drafted a suggested reply for review", agentRunId: out.runId });
  return { message: out.output.message, heuristic: out.heuristic };
}

export async function triggerHandoff(ctx: OrgContext, leadId: string, reason: string) {
  const s = staff(ctx);
  await cancelPendingFollowUps(ctx, leadId, "needs_human");
  const lead = await updateLead(ctx, leadId, {
    stage: "needs_human",
    controlMode: "human",
    assignedTo: s.userId,
    handoff: { required: true, priority: "normal", reason: reason || "Escalated by staff", ownerSummary: reason || "Escalated manually", requestedAt: new Date().toISOString() },
  });
  await log(ctx, lead, "handoff_requested", `Escalated to a person by ${s.name}`, reason);
  return lead;
}
