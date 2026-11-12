"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/session";
import { leadSubmissionSchema } from "@/features/leads/intake-schema";
import { createInboundLead } from "@/server/services/lead-intake";
import * as actions from "@/server/services/lead-actions";
import { handleInboundMessage, handleNewLead, bookSlotNow, offerTimesNow } from "@/ai/orchestrator";
import { getLead } from "@/server/repositories/leads";
import { getPrimaryConversation, markConversationRead, recordInboundMessage } from "@/server/repositories/conversations";
import { getSettings } from "@/server/repositories/settings";
import { getAvailableSlots } from "@/server/repositories/appointments";
import { sendNextFollowUpNow } from "@/server/jobs/follow-ups";
import { listTeam } from "@/server/repositories/lead-list";
import { LEAD_STAGES } from "@/types/domain";
import { act, UserError } from "./result";

const id = z.string().uuid();

function refresh(leadId?: string) {
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  revalidatePath("/overview");
}

export async function takeOverAction(leadId: string) {
  return act("takeOver", async () => {
    const { ctx } = await requireOrgContext();
    await actions.takeOver(ctx, id.parse(leadId));
    refresh(leadId);
  }, "You're in control — Signal won't message this lead.");
}

export async function returnToSignalAction(leadId: string) {
  return act("returnToSignal", async () => {
    const { ctx } = await requireOrgContext();
    await actions.returnToSignal(ctx, id.parse(leadId));
    refresh(leadId);
  }, "Control returned to Signal.");
}

export async function pauseAutopilotAction(leadId: string) {
  return act("pause", async () => {
    const { ctx } = await requireOrgContext();
    await actions.pauseAutopilot(ctx, id.parse(leadId));
    refresh(leadId);
  }, "Autopilot paused.");
}

export async function markWonAction(leadId: string, value: number | null) {
  return act("markWon", async () => {
    const { ctx } = await requireOrgContext();
    await actions.markWon(ctx, id.parse(leadId), value === null ? null : z.number().min(0).max(10_000_000).parse(value));
    refresh(leadId);
  }, "Marked as won. Nice work.");
}

export async function markLostAction(leadId: string, reason: string) {
  return act("markLost", async () => {
    const { ctx } = await requireOrgContext();
    await actions.markLost(ctx, id.parse(leadId), z.string().max(200).parse(reason));
    refresh(leadId);
  }, "Marked as lost.");
}

export async function changeStageAction(leadId: string, stage: string) {
  return act("changeStage", async () => {
    const { ctx } = await requireOrgContext();
    await actions.changeStage(ctx, id.parse(leadId), z.enum(LEAD_STAGES).parse(stage));
    refresh(leadId);
  });
}

export async function overrideScoreAction(leadId: string, score: number, reason: string) {
  return act("overrideScore", async () => {
    const { ctx } = await requireOrgContext();
    await actions.overrideScore(ctx, id.parse(leadId), z.number().int().min(0).max(100).parse(score), z.string().max(200).parse(reason));
    refresh(leadId);
  }, "Score updated.");
}

export async function assignLeadAction(leadId: string, userId: string | null) {
  return act("assign", async () => {
    const { ctx } = await requireOrgContext();
    const team = await listTeam(ctx);
    const member = userId ? team.find((t) => t.id === userId) : null;
    if (userId && !member) throw new UserError("That person isn't on your team");
    await actions.assignLead(ctx, id.parse(leadId), member?.id ?? null, member?.name ?? null);
    refresh(leadId);
  }, "Assignment updated.");
}

export async function sendStaffMessageAction(leadId: string, body: string) {
  return act("sendStaffMessage", async () => {
    const { ctx } = await requireOrgContext();
    const res = await actions.sendStaffMessage(ctx, id.parse(leadId), z.string().trim().min(1, "Write a message first").max(4000).parse(body));
    refresh(leadId);
    if (!res.ok) throw new UserError(`Not sent: ${res.error}`);
  }, "Message sent.");
}

export async function addNoteAction(leadId: string, body: string) {
  return act("addNote", async () => {
    const { ctx } = await requireOrgContext();
    await actions.addNote(ctx, id.parse(leadId), z.string().trim().min(1).max(4000).parse(body));
    refresh(leadId);
  }, "Note added.");
}

export async function suggestReplyAction(leadId: string) {
  return act("suggestReply", async () => {
    const { ctx } = await requireOrgContext();
    const out = await actions.suggestReply(ctx, id.parse(leadId));
    refresh(leadId);
    return out;
  });
}

export async function triggerHandoffAction(leadId: string, reason: string) {
  return act("handoff", async () => {
    const { ctx } = await requireOrgContext();
    await actions.triggerHandoff(ctx, id.parse(leadId), z.string().max(200).parse(reason));
    refresh(leadId);
  }, "Escalated — automation stopped for this lead.");
}

export async function getSlotsAction() {
  return act("getSlots", async () => {
    const { ctx } = await requireOrgContext();
    return getAvailableSlots(ctx, await getSettings(ctx), { limit: 6 });
  });
}

export async function offerTimesAction(leadId: string) {
  return act("offerTimes", async () => {
    const { ctx } = await requireOrgContext();
    const r = await offerTimesNow(ctx, id.parse(leadId));
    refresh(leadId);
    if (!r.ok) throw new UserError(r.error ?? "Automation failed");
  }, "Appointment times sent to the customer.");
}

const slotSchema = z.object({ id: z.string().max(4), startsAt: z.string().datetime(), endsAt: z.string().datetime(), label: z.string().max(80) });
export async function bookSlotAction(leadId: string, slot: z.infer<typeof slotSchema>) {
  return act("bookSlot", async () => {
    const { ctx } = await requireOrgContext();
    const r = await bookSlotNow(ctx, id.parse(leadId), slotSchema.parse(slot));
    refresh(leadId);
    if (!r.ok) throw new UserError(r.error ?? "Automation failed");
  }, "Appointment booked.");
}

export async function markReadAction(leadId: string) {
  const { ctx } = await requireOrgContext();
  const lead = await getLead(ctx, id.parse(leadId));
  const conversation = await getPrimaryConversation(ctx, lead);
  if (conversation.unreadCount > 0) {
    await markConversationRead(ctx, conversation.id);
    revalidatePath("/inbox");
  }
}

/** Manual lead entry by staff — runs the same NEW_LEAD workflow in the background. */
export async function createManualLeadAction(input: unknown) {
  return act("createManualLead", async () => {
    const { ctx } = await requireOrgContext();
    const data = leadSubmissionSchema.parse(input);
    const result = await createInboundLead(ctx, data, { source: "manual", consentText: data.consent ? "Consent confirmed by staff" : undefined });
    after(() => (result.isNew ? handleNewLead(ctx, result.leadId) : handleInboundMessage(ctx, result.leadId, result.messageId)));
    refresh();
    return { leadId: result.leadId };
  }, "Lead added — Signal is on it.");
}

/* ---------------------------------------------------------------- Demo simulation tools */

/** Demo: simulate the customer replying (goes through the exact inbound pipeline). */
export async function simulateCustomerReplyAction(leadId: string, body: string) {
  return act("simulateReply", async () => {
    const { ctx } = await requireOrgContext();
    const lead = await getLead(ctx, id.parse(leadId));
    const text = z.string().trim().min(1, "Type the customer's reply").max(2000).parse(body);
    const conversation = await getPrimaryConversation(ctx, lead);
    const channel = lead.preferredChannel === "sms" ? "sms" : lead.preferredChannel === "email" ? "email" : "web";
    const msg = await recordInboundMessage(ctx, { lead, conversation, body: text, channel, metadata: { simulated: true } });
    const r = await handleInboundMessage(ctx, lead.id, msg.id);
    refresh(leadId);
    if (!r.ok) throw new UserError(r.error ?? "Automation failed");
  });
}

/** Demo: fast-forward the next scheduled follow-up for this lead. */
export async function sendNextFollowUpAction(leadId: string) {
  return act("sendNextFollowUp", async () => {
    const { ctx } = await requireOrgContext();
    const r = await sendNextFollowUpNow(ctx, id.parse(leadId));
    refresh(leadId);
    if (!r.claimed) return "No follow-up is scheduled for this lead.";
    if (r.sent) return "Follow-up sent.";
    if (r.cancelled) return "Follow-up was cancelled by a stop condition (see timeline).";
    if (r.rescheduled) return "Outside messaging hours — follow-up rescheduled.";
    return "Follow-up failed — see the timeline.";
  });
}

/** Re-run intake on a lead (manual re-run for reliability). */
export async function rerunIntakeAction(leadId: string) {
  return act("rerunIntake", async () => {
    const { ctx } = await requireOrgContext();
    const r = await handleNewLead(ctx, id.parse(leadId));
    refresh(leadId);
    if (!r.ok) throw new UserError(r.error ?? "Automation failed");
  }, "Signal re-processed this lead.");
}
