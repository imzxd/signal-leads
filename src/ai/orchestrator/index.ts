/**
 * Signal Orchestrator — coordinates known workflows. It is NOT a conversational agent:
 *
 *   NEW_LEAD    → intake → validation → qualification → scoring → respond → schedule follow-ups
 *   LEAD_REPLY  → cancel follow-ups → (opt-out?) → parse reply → update lead → qualify → rescore → next action
 *   QUALIFIED   → booking workflow (offer real slots → book chosen slot → confirm → notify)
 *   NO_REPLY    → follow-up workflow (server/jobs/follow-ups.ts)
 *   UNCERTAIN   → handoff workflow
 *   CONVERTED   → stop automation, record conversion (server/services/lead-actions.ts)
 *
 * Business logic lives in code (decide.ts, scoring engine, stop conditions) — not in prompts.
 */
import type { OrgContext } from "@/server/context";
import { getSettings } from "@/server/repositories/settings";
import { partitionFieldUpdates } from "@/server/repositories/leads";
import { getMessage, getPrimaryConversation, listMessages, transcriptExcerpt } from "@/server/repositories/conversations";
import { recordEvent } from "@/server/repositories/events";
import { leadHadSentFollowUpSince } from "@/server/jobs/follow-ups";
import { revokeAllConsent } from "@/lib/messaging/consent";
import { logger } from "@/lib/observability/logger";
import { intakeAgent } from "@/ai/agents/intake/agent";
import { replyParserAgent } from "@/ai/agents/reply-parser/agent";
import { bookingAgent } from "@/ai/agents/booking/agent";
import { detectNotInterested, detectSentiment, detectUrgency, isOptOut } from "@/ai/agents/shared/text-signals";
import { estimateLeadValue } from "@/features/leads/business-rules";
import { receipt } from "@/features/leads/receipts";
import { TERMINAL_STAGES, URGENCIES, type Urgency } from "@/types/domain";
import { tools, must } from "@/ai/tools";
import { withLeadLock } from "./lock";
import { bookSlot, evaluateAndRespond, event, makeState, offerBooking, patchLead, run, type WorkflowState } from "./pipeline";

export interface WorkflowResult {
  ok: boolean;
  error?: string;
}

async function guarded(ctx: OrgContext, leadId: string, name: string, fn: () => Promise<void>): Promise<WorkflowResult> {
  try {
    await withLeadLock(leadId, fn);
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("orchestrator.workflow_failed", { workflow: name, leadId, error });
    // Failures are never silent: they land on the lead's timeline and in the owner's notifications.
    await recordEvent(ctx, { leadId, type: "error", actor: "system", actorLabel: "Signal", title: `Automation error during ${name}`, detail: error }).catch(() => undefined);
    await tools.notifyOwner(ctx, { leadId, type: "automation_error", priority: "normal", title: "Automation needs attention", body: `${name} failed: ${error}` }).catch(() => undefined);
    return { ok: false, error };
  }
}

async function loadState(ctx: OrgContext, leadId: string, sourceMessageId?: string): Promise<WorkflowState> {
  const settings = await getSettings(ctx);
  const lead = must(await tools.getLead(ctx, { leadId }));
  const conversation = await getPrimaryConversation(ctx, lead);
  const msgs = await listMessages(ctx, lead.id);
  const source = sourceMessageId ?? msgs.find((m) => m.direction === "inbound")?.id ?? lead.id;
  return makeState(ctx, settings, lead, conversation, msgs, source);
}

const URGENCY_RANK: Record<Urgency, number> = { emergency: 4, urgent: 3, soon: 2, flexible: 1, unknown: 0 };
const moreUrgent = (a: Urgency, b: Urgency) => (URGENCY_RANK[b] > URGENCY_RANK[a] ? b : a);

/** NEW_LEAD workflow. */
export function handleNewLead(ctx: OrgContext, leadId: string): Promise<WorkflowResult> {
  return guarded(ctx, leadId, "new lead intake", async () => {
    const s = await loadState(ctx, leadId);
    if (s.lead.controlMode !== "autopilot" || (TERMINAL_STAGES as readonly string[]).includes(s.lead.stage)) return;
    const first = s.msgs.find((m) => m.direction === "inbound");
    const text = first?.body ?? "";

    const intake = await run(s, intakeAgent, {
      business: s.business,
      message: text,
      source: s.lead.source,
      form: { name: s.lead.name, email: s.lead.email, phone: s.lead.phone, company: s.lead.company, service: s.lead.serviceRequested },
    });
    const o = intake.output;
    const { columns, custom } = partitionFieldUpdates(s.lead, o.fields);
    await patchLead(
      s,
      {
        ...columns,
        name: s.lead.name ?? o.name,
        email: s.lead.email ?? o.email,
        phone: s.lead.phone ?? o.phone,
        company: s.lead.company ?? o.company,
        serviceKey: o.serviceKey,
        serviceRequested: o.serviceRequested ?? s.lead.serviceRequested,
        intent: o.intent,
        urgency: o.urgency,
        timeline: o.timeline ?? columns.timeline ?? null,
        budget: o.budget ?? columns.budget ?? null,
        location: o.location ?? columns.location ?? null,
        address: o.address ?? columns.address ?? null,
        summary: o.summary,
        isExistingCustomer: o.isExistingCustomer,
        aiConfidence: o.confidence,
        estimatedValue: estimateLeadValue(o.serviceKey, s.settings.services, s.settings.averageDealValue),
      },
      custom,
    );
    const facts = [
      o.urgency !== "unknown" ? `Urgency: ${o.urgency}` : null,
      o.location ? `Location: ${o.location}` : null,
      o.timeline ? `Timeline: ${o.timeline}` : null,
      o.budget ? `Budget: ${o.budget}` : null,
      ...o.fields.map((f) => `${f.key.replace(/_/g, " ")}: ${f.value}`),
    ].filter((x): x is string => Boolean(x));
    await event(s, {
      type: "intake_completed",
      actor: "agent",
      actorLabel: "Intake Agent",
      title: o.intent === "spam" ? "Intake Agent flagged a likely spam message" : `Intake Agent identified “${titleCase(o.serviceRequested ?? o.intent.replace(/_/g, " "))}”`,
      detail: o.summary,
      agentRunId: intake.runId,
      receipt: receipt({ headline: o.summary, reasons: facts, confidence: o.confidence, fallback: intake.fellBack }),
    });

    await evaluateAndRespond(s, {
      inboundText: text,
      questions: o.questions,
      sentiment: o.sentiment,
      notInterested: false,
      isFirstContact: true,
    });
  });
}

/** LEAD_REPLY workflow. */
export function handleInboundMessage(ctx: OrgContext, leadId: string, messageId: string): Promise<WorkflowResult> {
  return guarded(ctx, leadId, "reply handling", async () => {
    const message = await getMessage(ctx, messageId);
    if (!message || message.leadId !== leadId || message.direction !== "inbound") throw new Error("Inbound message not found for this lead");
    const s = await loadState(ctx, leadId, messageId);
    const body = message.body;

    await event(s, { type: "reply_received", actor: "lead", actorLabel: s.lead.name ?? "Customer", title: "Lead responded", detail: body });

    // Any reply stops the pending sequence immediately.
    const cancelled = await tools.cancelFollowUps(ctx, { leadId, reason: "lead_responded" });
    if (cancelled.ok && cancelled.data > 0) {
      await event(s, { type: "follow_up_cancelled", actor: "system", actorLabel: "Follow-Up Agent", title: `Cancelled ${cancelled.data} pending follow-up${cancelled.data === 1 ? "" : "s"} — lead replied` });
    }

    // Recovered lead: re-engaged after an automated follow-up was sent.
    const previousInbound = [...s.msgs].reverse().find((m) => m.direction === "inbound" && m.id !== messageId);
    const recoveredBySeq = await leadHadSentFollowUpSince(ctx, leadId, previousInbound?.createdAt ?? null);
    if (recoveredBySeq > 0 && !s.lead.recoveredAt) {
      await patchLead(s, { recoveredAt: new Date() });
      await event(s, {
        type: "lead_recovered",
        actor: "system",
        actorLabel: "Signal",
        title: `Lead recovered by follow-up ${recoveredBySeq}`,
        receipt: receipt({ headline: "Went quiet, then re-engaged after an automated follow-up", reasons: [`Follow-up ${recoveredBySeq} preceded this reply`], nextAction: "Continue qualification" }),
      });
    }

    // Opt-out is compliance-critical and fully deterministic.
    if (isOptOut(body)) {
      await revokeAllConsent(ctx, leadId, "opt_out_keyword", body.slice(0, 200));
      await tools.cancelFollowUps(ctx, { leadId, reason: "opted_out" });
      await patchLead(s, { optedOutAt: new Date(), nextAction: "Opted out — do not contact" });
      await event(s, { type: "opted_out", actor: "lead", actorLabel: s.lead.name ?? "Customer", title: "Lead opted out — all messaging stopped", receipt: receipt({ headline: "Consent revoked on every channel", reasons: [`Message: “${body.slice(0, 80)}”`] }) });
      return;
    }

    // Human in control (or lead closed): record and alert, never reply automatically.
    if (s.lead.controlMode !== "autopilot" || s.lead.stage === "needs_human" || (TERMINAL_STAGES as readonly string[]).includes(s.lead.stage)) {
      await tools.notifyOwner(ctx, { leadId, type: "reply", priority: "normal", title: `New reply from ${s.lead.name ?? "a lead"}`, body: body.slice(0, 280) });
      await patchLead(s, { nextAction: "Reply to the customer" });
      return;
    }

    // Booking selection takes priority when times were offered.
    const offered = s.lead.bookingState.offeredSlots ?? [];
    const allowedFieldKeys = [...new Set(["name", "email", "phone", "address", "location", "timeline", "budget", "company", ...s.settings.qualificationFields.map((f) => f.key)])];
    const pendingField = s.settings.qualificationFields.find((f) => f.key === s.lead.automationState.pendingField) ?? null;
    const parsed = await run(s, replyParserAgent, {
      business: s.business,
      reply: body,
      pendingField,
      allowedFieldKeys,
      offeredSlots: offered,
      conversationExcerpt: transcriptExcerpt(s.msgs, s.settings.businessName, 8),
    });
    const p = parsed.output;

    if (offered.length && s.lead.stage !== "booked") {
      let slotId = p.selectedSlotId;
      if (!slotId && p.kind !== "question" && /\b(\d|mon|tue|wed|thu|fri|sat|sun|morning|afternoon|first|second|third|works|perfect|book)/i.test(body)) {
        const b = await run(s, bookingAgent, { businessName: s.settings.businessName, reply: body, offeredSlots: offered });
        slotId = b.output.selectedSlotId;
      }
      const slot = offered.find((x) => x.id === slotId);
      if (slot) {
        await event(s, { type: "booking_offered", actor: "agent", actorLabel: "Booking Agent", title: `Lead selected ${slot.label}`, agentRunId: parsed.runId });
        await bookSlot(s, slot, "agent");
        return;
      }
      if (p.kind === "reschedule") {
        await patchLead(s, { bookingState: {} });
        await offerBooking(s, {});
        return;
      }
    }

    // Apply newly learned facts. The reply's parse confidence becomes the lead's current AI confidence.
    await patchLead(s, { aiConfidence: p.confidence });
    const { columns, custom } = partitionFieldUpdates(s.lead, p.fields);
    const answeredPending = pendingField && p.fields.some((f) => f.key === pendingField.key);
    const urgency = moreUrgent(s.lead.urgency, (URGENCIES as readonly string[]).includes(p.urgency) ? p.urgency : detectUrgency(body));
    if (Object.keys(columns).length || custom.length || urgency !== s.lead.urgency || answeredPending) {
      await patchLead(
        s,
        { ...columns, urgency, automationState: { ...s.lead.automationState, pendingField: answeredPending ? null : s.lead.automationState.pendingField } },
        custom,
      );
      const learned = p.fields.map((f) => `${f.key.replace(/_/g, " ")}: ${f.value}`);
      if (learned.length) {
        await event(s, {
          type: "intake_completed",
          actor: "agent",
          actorLabel: "Reply Parser",
          title: `Learned ${learned.length === 1 ? learned[0] : `${learned.length} new details`}`,
          agentRunId: parsed.runId,
          receipt: receipt({ headline: "Extracted from the customer's reply", reasons: learned, confidence: p.confidence, fallback: parsed.fellBack }),
        });
      }
    }

    await evaluateAndRespond(s, {
      inboundText: body,
      questions: p.questions,
      sentiment: p.sentiment === "neutral" ? detectSentiment(body) : p.sentiment,
      notInterested: p.kind === "not_interested" || detectNotInterested(body),
      isFirstContact: false,
    });
  });
}

/** QUALIFIED → booking, triggered manually by staff ("Book" → "Offer times"). */
export function offerTimesNow(ctx: OrgContext, leadId: string): Promise<WorkflowResult> {
  return guarded(ctx, leadId, "booking offer", async () => {
    const s = await loadState(ctx, leadId, `manual-offer-${Date.now()}`);
    await offerBooking(s, { forced: true });
  });
}

/** Staff picks a slot directly. */
export function bookSlotNow(ctx: OrgContext, leadId: string, slot: { id: string; startsAt: string; endsAt: string; label: string }): Promise<WorkflowResult> {
  return guarded(ctx, leadId, "booking", async () => {
    const s = await loadState(ctx, leadId, `manual-book-${slot.startsAt}`);
    await bookSlot(s, slot, "staff");
  });
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
