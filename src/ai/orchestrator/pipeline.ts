import { leadScores, type Conversation, type Lead, type Message } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import type { ResolvedSettings } from "@/server/repositories/settings";
import { toBusinessProfile } from "@/server/repositories/settings";
import { getCustomFields, knownFieldsFor } from "@/server/repositories/leads";
import { listMessages, transcriptExcerpt } from "@/server/repositories/conversations";
import { recordEvent, type NewEvent } from "@/server/repositories/events";
import { AUTOMATION_KEYS, isAutomationEnabled, recordAutomationRun, type AutomationKey } from "@/server/repositories/automations";
import { chunkTitles } from "@/server/repositories/knowledge";
import { SlotUnavailableError } from "@/server/repositories/appointments";
import { BLOCK_REASON_LABELS } from "@/lib/messaging/outbound";
import { emitOutboundEvent } from "@/lib/integrations/n8n";
import { runAgent, type AgentContext, type AgentOutcome } from "@/ai/runtime/run-agent";
import type { BusinessProfile } from "@/ai/agents/shared/context";
import { firstName } from "@/ai/agents/shared/text-signals";
import {
  computeMissingFields,
  qualificationAgent,
  qualificationHeuristic,
  qualificationNeedsModel,
  type QualificationInput,
} from "@/ai/agents/qualification/agent";
import type { QualificationOutput } from "@/ai/agents/qualification/schema";
import { scoringAgent, scoreWithSignals } from "@/ai/agents/scoring/agent";
import { knowledgeAgent, KNOWLEDGE_MIN_CONFIDENCE } from "@/ai/agents/knowledge/agent";
import { detectHandoffTriggers, HARD_TRIGGERS, TRIGGER_PRIORITY } from "@/ai/agents/handoff/triggers";
import { handoffAgent } from "@/ai/agents/handoff/agent";
import { draftingAgent, type DraftPurpose } from "@/ai/agents/drafting/agent";
import { summaryAgent } from "@/ai/agents/summary/agent";
import { checkServiceArea, checkServiceSupported, estimateLeadValue } from "@/features/leads/business-rules";
import { diffFactors } from "@/features/leads/scoring/engine";
import type { ScoreFactor } from "@/features/leads/scoring/types";
import { receipt } from "@/features/leads/receipts";
import type { OfferedSlot } from "@/features/leads/lead-state";
import type { Sentiment } from "@/ai/agents/shared/text-signals";
import { TEMPERATURE_LABELS } from "@/types/domain";
import { tools, must } from "@/ai/tools";
import { decideNextAction, type Decision } from "./decide";
import { desc, eq } from "drizzle-orm";

export interface WorkflowState {
  ctx: OrgContext;
  settings: ResolvedSettings;
  business: BusinessProfile;
  lead: Lead;
  conversation: Conversation;
  msgs: Message[];
  agentCtx: AgentContext;
  fallbacks: number;
  /** The inbound message that triggered this run — anchors idempotency keys. */
  sourceMessageId: string;
}

export function makeState(ctx: OrgContext, settings: ResolvedSettings, lead: Lead, conversation: Conversation, msgs: Message[], sourceMessageId: string): WorkflowState {
  return {
    ctx,
    settings,
    business: toBusinessProfile(settings),
    lead,
    conversation,
    msgs,
    agentCtx: { db: ctx.db, organizationId: ctx.organizationId, leadId: lead.id },
    fallbacks: 0,
    sourceMessageId,
  };
}

export async function run<I, O>(s: WorkflowState, def: Parameters<typeof runAgent<I, O>>[0], input: I): Promise<AgentOutcome<O>> {
  const outcome = await runAgent(def, input, s.agentCtx);
  if (outcome.status === "fallback") s.fallbacks++;
  return outcome;
}

export async function event(s: WorkflowState, e: Omit<NewEvent, "leadId">) {
  return recordEvent(s.ctx, { ...e, leadId: s.lead.id });
}

export async function patchLead(s: WorkflowState, patch: Parameters<typeof tools.updateLeadFields>[1]["patch"], customFields?: { key: string; value: string }[]) {
  s.lead = must(await tools.updateLeadFields(s.ctx, { leadId: s.lead.id, patch, customFields }));
  return s.lead;
}

export interface Signals {
  inboundText: string;
  questions: string[];
  sentiment: Sentiment;
  notInterested: boolean;
  isFirstContact: boolean;
}

/**
 * NEW_LEAD / LEAD_REPLY shared tail:
 *   business-rule validation → qualification → scoring → knowledge → handoff check
 *   → decide next action → respond → schedule next action
 */
export async function evaluateAndRespond(s: WorkflowState, sig: Signals): Promise<Decision> {
  const { settings } = s;

  // 1. Business-rule validation (deterministic)
  const serviceSupported = checkServiceSupported(s.lead.serviceKey, s.lead.serviceRequested, s.lead.intent, settings.services);
  const inServiceArea = checkServiceArea(s.lead.location, s.lead.address, settings.serviceArea);
  if (sig.isFirstContact || serviceSupported !== "unknown" || inServiceArea !== "unknown") {
    const reasons = [
      serviceSupported === "yes" ? "Requested service is offered" : serviceSupported === "no" ? "Requested service is not offered" : "Service not identified yet",
      inServiceArea === "yes" ? `${s.lead.location ?? "Address"} is inside the service area` : inServiceArea === "no" ? `${s.lead.location} is outside the service area` : "Location not known yet",
    ];
    const passed = serviceSupported !== "no" && inServiceArea !== "no";
    if (sig.isFirstContact || !passed || inServiceArea === "yes") {
      await event(s, {
        type: "validation",
        actor: "system",
        actorLabel: "Business rules",
        title: passed ? (inServiceArea === "yes" ? "Service-area validation passed" : "Business rules checked") : "Business-rule check flagged this lead",
        receipt: receipt({ headline: passed ? "Within business rules" : "Outside business rules", reasons }),
      });
    }
  }

  // 2. Qualification (deterministic gap analysis; model only chooses/phrases the question)
  const custom = await getCustomFields(s.ctx, s.lead.id);
  const known = knownFieldsFor(s.lead, custom);
  const missing = computeMissingFields(settings.qualificationFields, s.lead.serviceKey, known);
  const qInput: QualificationInput = {
    business: s.business,
    serviceKey: s.lead.serviceKey,
    known,
    missing,
    askCounts: s.lead.automationState.askCounts ?? {},
    conversationExcerpt: transcriptExcerpt(s.msgs, settings.businessName, 6),
  };
  let qualification: QualificationOutput;
  let qualificationRunId: string | null = null;
  if (qualificationNeedsModel(qInput)) {
    const q = await run(s, qualificationAgent, qInput);
    qualification = q.output;
    qualificationRunId = q.runId;
  } else {
    qualification = qualificationHeuristic(qInput);
  }

  // 3. Scoring (AI semantic signals + deterministic weighted engine)
  const inboundText = s.msgs.filter((m) => m.direction === "inbound").map((m) => m.body).join("\n") || sig.inboundText;
  const signals = await run(s, scoringAgent, {
    business: s.business,
    summary: s.lead.summary,
    serviceRequested: s.lead.serviceRequested,
    urgency: s.lead.urgency,
    timeline: s.lead.timeline,
    conversationExcerpt: transcriptExcerpt(s.msgs, settings.businessName, 6),
    inboundText,
  });
  const requiredFields = settings.qualificationFields.filter((f) => f.required && (!f.services?.length || (s.lead.serviceKey && f.services.includes(s.lead.serviceKey))));
  const inboundCount = s.msgs.filter((m) => m.direction === "inbound").length;
  const score = scoreWithSignals(
    {
      serviceSupported,
      inServiceArea,
      urgency: s.lead.urgency,
      requiredFieldsTotal: requiredFields.length,
      requiredFieldsKnown: requiredFields.length - missing.filter((m) => m.required).length,
      hasContactMethod: Boolean(s.lead.email || s.lead.phone),
      inboundReplies: Math.max(0, inboundCount - 1),
      isExistingCustomer: s.lead.isExistingCustomer,
    },
    signals.output,
    settings.scoringWeights,
  );
  const previousScore = s.lead.score;
  const previousTemperature = s.lead.temperature;
  const [lastScore] = await s.ctx.db.select().from(leadScores).where(eq(leadScores.leadId, s.lead.id)).orderBy(desc(leadScores.createdAt)).limit(1);
  const delta = score.score - (lastScore ? previousScore : 0);
  const { gained, lost } = diffFactors((lastScore?.factors ?? []) as ScoreFactor[], score.factors);

  // 4. Knowledge (only when the customer asked something)
  let knowledgeAnswer: string | null = null;
  let unansweredQuestion: string | null = null;
  for (const question of sig.questions.slice(0, 2)) {
    const chunks = await tools.searchKnowledge(s.ctx, { query: question, k: 4 });
    const k = await run(s, knowledgeAgent, { businessName: settings.businessName, question, chunks: chunks.ok ? chunks.data : [] });
    if (k.output.answerable && k.output.confidence >= KNOWLEDGE_MIN_CONFIDENCE) {
      knowledgeAnswer = [knowledgeAnswer, k.output.answer].filter(Boolean).join(" ");
      const sources = await chunkTitles(s.ctx, k.output.sourceIds);
      await event(s, {
        type: "knowledge_answered",
        actor: "agent",
        actorLabel: "Knowledge Agent",
        title: "Knowledge Agent answered a question",
        detail: `“${question}”`,
        agentRunId: k.runId,
        receipt: receipt({ headline: "Answered from the knowledge base", reasons: [k.output.answer ?? ""], sources, confidence: k.output.confidence, fallback: k.fellBack }),
      });
    } else {
      unansweredQuestion = question;
      await event(s, {
        type: "knowledge_escalated",
        actor: "agent",
        actorLabel: "Knowledge Agent",
        title: "Question not covered — flagged for the team",
        detail: `“${question}”`,
        agentRunId: k.runId,
        receipt: receipt({ headline: "No grounded answer — did not guess", reasons: ["Knowledge base has no matching policy or fact"], nextAction: "Team confirms the answer", confidence: k.output.confidence }),
      });
    }
  }

  // 5. Handoff check (deterministic triggers; Handoff Agent only when something fired)
  const triggers = detectHandoffTriggers({
    text: sig.inboundText,
    sentiment: sig.sentiment,
    // A vague first message deserves a clarifying question, not a handoff; low confidence
    // escalates only when we can't understand a reply mid-conversation.
    aiConfidence: sig.isFirstContact ? null : s.lead.aiConfidence,
    estimatedValue: s.lead.estimatedValue,
    serviceSupported,
    inServiceArea,
    unansweredQuestion: false, // unanswered questions are escalated softly above, not a full handoff
    consecutiveFallbacks: (s.lead.automationState.consecutiveFallbacks ?? 0) + s.fallbacks,
    rules: settings.escalationRules,
  }).filter((t) => !(signals.output.isSpam && t !== "legal_threat"));
  let handoff: { required: boolean; priority: "low" | "normal" | "high" | "urgent"; reason: string; ownerSummary: string; runId: string | null } = {
    required: false,
    priority: "low",
    reason: "",
    ownerSummary: "",
    runId: null,
  };
  const significant = triggers.filter((t) => TRIGGER_PRIORITY[t] !== "low" || HARD_TRIGGERS.includes(t));
  if (significant.length) {
    const h = await run(s, handoffAgent, {
      businessName: settings.businessName,
      triggers,
      leadName: s.lead.name,
      leadSummary: s.lead.summary,
      estimatedValue: s.lead.estimatedValue,
      lastMessage: sig.inboundText,
      conversationExcerpt: transcriptExcerpt(s.msgs, settings.businessName, 8),
    });
    handoff = { required: h.output.handoffRequired, priority: h.output.priority, reason: h.output.reason, ownerSummary: h.output.ownerSummary, runId: h.runId };
  }

  // 6. Decide (deterministic policy)
  const decision = decideNextAction({
    isSpam: signals.output.isSpam,
    handoffRequired: handoff.required,
    notInterested: sig.notInterested,
    serviceSupported,
    inServiceArea,
    qualificationComplete: qualification.qualificationComplete,
    targetField: qualification.targetField,
    score: score.score,
    alreadyBooked: s.lead.stage === "booked",
  });

  // Persist intelligence before acting.
  await patchLead(s, {
    score: score.score,
    temperature: score.temperature,
    missingFields: qualification.missingFields,
    qualificationComplete: qualification.qualificationComplete,
    isSpam: signals.output.isSpam,
    estimatedValue: s.lead.estimatedValue ?? estimateLeadValue(s.lead.serviceKey, settings.services, settings.averageDealValue),
    automationState: { ...s.lead.automationState, consecutiveFallbacks: s.fallbacks ? (s.lead.automationState.consecutiveFallbacks ?? 0) + 1 : 0 },
  });
  await s.ctx.db.insert(leadScores).values({
    organizationId: s.ctx.organizationId,
    leadId: s.lead.id,
    agentRunId: signals.runId,
    score: score.score,
    previousScore: lastScore ? previousScore : null,
    temperature: score.temperature,
    factors: score.factors,
    explanation: score.explanation,
    recommendedAction: decision.label,
    source: "engine",
  });
  if (!lastScore || delta !== 0) {
    await event(s, {
      type: "score_changed",
      actor: "agent",
      actorLabel: "Scoring Agent",
      title: !lastScore ? `Lead scored ${score.score} — ${TEMPERATURE_LABELS[score.temperature]}` : `Lead score ${delta > 0 ? "increased" : "decreased"} from ${previousScore} → ${score.score}`,
      agentRunId: signals.runId,
      receipt: receipt({
        headline: !lastScore ? score.explanation : `Score ${delta > 0 ? "+" : ""}${delta}`,
        scoreDelta: lastScore ? delta : undefined,
        reasons: (lastScore ? [...gained.map((f) => f.label), ...lost.map((f) => `No longer: ${f.label.toLowerCase()}`)] : score.factors.filter((f) => f.kind === "positive").map((f) => f.label)).slice(0, 5),
        nextAction: decision.label,
        confidence: signals.output.confidence,
        fallback: signals.fellBack,
      }),
    });
  }

  // 7. Act
  await execute(s, decision, { qualification, qualificationRunId, knowledgeAnswer, unansweredQuestion, handoff, isFirstContact: sig.isFirstContact });

  // 8. Hot lead alert (once per lead)
  if (score.temperature === "hot" && previousTemperature !== "hot" && decision.kind !== "ignore_spam") {
    if (await isAutomationEnabled(s.ctx, AUTOMATION_KEYS.hotLeadAlert)) {
      await tools.notifyOwner(s.ctx, {
        leadId: s.lead.id,
        type: "hot_lead",
        priority: "urgent",
        title: `Hot lead: ${s.lead.name ?? "New lead"} (${score.score})`,
        body: score.explanation,
      });
      await event(s, { type: "owner_notified", actor: "system", actorLabel: "Hot Lead Alert", title: "Owner notified — hot lead", detail: score.explanation });
      await recordAutomationRun(s.ctx, AUTOMATION_KEYS.hotLeadAlert, s.lead.id, "succeeded", `Score ${score.score}`);
      void emitOutboundEvent("lead.hot", s.ctx.organizationId, { leadId: s.lead.id, score: score.score });
    }
  }

  await refreshSummary(s);
  return decision;
}

interface ExecuteExtras {
  qualification: QualificationOutput;
  qualificationRunId: string | null;
  knowledgeAnswer: string | null;
  unansweredQuestion: string | null;
  handoff: { required: boolean; priority: "low" | "normal" | "high" | "urgent"; reason: string; ownerSummary: string; runId: string | null };
  isFirstContact: boolean;
}

async function execute(s: WorkflowState, decision: Decision, x: ExecuteExtras) {
  const purposeFor = (fallback: DraftPurpose): DraftPurpose => (x.isFirstContact ? "first_response" : fallback);
  switch (decision.kind) {
    case "ignore_spam": {
      await tools.cancelFollowUps(s.ctx, { leadId: s.lead.id, reason: "spam" });
      await patchLead(s, { stage: "archived", nextAction: decision.label });
      await event(s, {
        type: "stage_changed",
        actor: "agent",
        actorLabel: "Signal",
        title: "Archived as spam — no reply sent",
        receipt: receipt({ headline: "Not a real inquiry", reasons: ["Spam or vendor pitch patterns", "No buying intent"], nextAction: "None" }),
      });
      return;
    }
    case "handoff":
      return performHandoff(s, x.handoff.priority, x.handoff.reason, x.handoff.ownerSummary, x.handoff.runId);
    case "close": {
      await composeAndSend(s, { purpose: "closing", automationKey: AUTOMATION_KEYS.newLead, eventTitle: "Sent a polite closing message" });
      await tools.cancelFollowUps(s.ctx, { leadId: s.lead.id, reason: "lost" });
      await patchLead(s, { stage: "lost", nextAction: decision.label, lostAt: new Date(), lostReason: "Customer not interested" });
      await event(s, { type: "lost", actor: "agent", actorLabel: "Signal", title: "Marked lost — customer not interested", receipt: receipt({ headline: "Customer declined", reasons: [decision.reason], nextAction: "Stop automation" }) });
      return;
    }
    case "out_of_scope": {
      await composeAndSend(s, { purpose: "out_of_scope", automationKey: AUTOMATION_KEYS.newLead, eventTitle: "Let the customer know the team will confirm fit", knowledgeAnswer: x.knowledgeAnswer });
      await tools.notifyOwner(s.ctx, { leadId: s.lead.id, type: "review", priority: "low", title: `Review: ${s.lead.name ?? "New lead"} — ${decision.reason.toLowerCase()}`, body: s.lead.summary ?? undefined });
      await patchLead(s, { stage: "qualifying", nextAction: decision.label });
      return;
    }
    case "ask_question": {
      const field = x.qualification.targetField!;
      const label = s.settings.qualificationFields.find((f) => f.key === field)?.label ?? field;
      await event(s, {
        type: "qualification",
        actor: "agent",
        actorLabel: "Qualification Agent",
        title: `Qualification Agent requested ${label.toLowerCase()}`,
        agentRunId: x.qualificationRunId,
        receipt: receipt({
          headline: `${x.qualification.missingFields.length} detail${x.qualification.missingFields.length === 1 ? "" : "s"} still needed`,
          reasons: [`Asking for: ${label}`, ...x.qualification.missingFields.filter((k) => k !== field).map((k) => `Also missing: ${k.replace(/_/g, " ")}`)].slice(0, 4),
          nextAction: "Wait for the customer's answer",
        }),
      });
      const sent = await composeAndSend(s, {
        purpose: purposeFor("reply"),
        automationKey: AUTOMATION_KEYS.newLead,
        nextQuestion: x.qualification.nextQuestion,
        knowledgeAnswer: x.knowledgeAnswer,
        unansweredQuestion: x.unansweredQuestion,
        eventTitle: x.isFirstContact ? "First response sent" : "Replied and asked the next question",
      });
      const askCounts = { ...(s.lead.automationState.askCounts ?? {}) };
      if (sent) askCounts[field] = (askCounts[field] ?? 0) + 1;
      await patchLead(s, { stage: "qualifying", nextAction: decision.label, automationState: { ...s.lead.automationState, pendingField: field, askCounts } });
      if (sent) await scheduleFollowUps(s, sent);
      return;
    }
    case "offer_booking":
      return offerBooking(s, { knowledgeAnswer: x.knowledgeAnswer, isFirstContact: x.isFirstContact });
    case "nurture": {
      if (s.lead.stage === "booked") return;
      const sent = await composeAndSend(s, {
        purpose: purposeFor("reply"),
        automationKey: AUTOMATION_KEYS.newLead,
        knowledgeAnswer: x.knowledgeAnswer,
        unansweredQuestion: x.unansweredQuestion,
        nextQuestion: "Would you like us to set up a time to take a look?",
        eventTitle: x.isFirstContact ? "First response sent" : "Replied to the customer",
      });
      await patchLead(s, { stage: s.lead.temperature === "hot" ? "hot" : "qualified", nextAction: decision.label, automationState: { ...s.lead.automationState, pendingField: null } });
      if (sent) await scheduleFollowUps(s, sent);
      return;
    }
  }
}

export async function offerBooking(s: WorkflowState, opts: { knowledgeAnswer?: string | null; isFirstContact?: boolean; forced?: boolean }) {
  if (!opts.forced && !(await isAutomationEnabled(s.ctx, AUTOMATION_KEYS.bookingOffer))) {
    await patchLead(s, { stage: s.lead.temperature === "hot" ? "hot" : "qualified", nextAction: "Book an appointment (booking automation off)" });
    await recordAutomationRun(s.ctx, AUTOMATION_KEYS.bookingOffer, s.lead.id, "skipped", "Automation disabled");
    return;
  }
  const slotsResult = await tools.getAvailableAppointments(s.ctx, {});
  const slots: OfferedSlot[] = slotsResult.ok ? slotsResult.data : [];
  if (!slots.length) {
    await tools.notifyOwner(s.ctx, { leadId: s.lead.id, type: "booking", priority: "high", title: `No open times to offer ${s.lead.name ?? "a qualified lead"}`, body: "Calendar has no availability in the next 14 days." });
    await patchLead(s, { stage: "hot", nextAction: "Book manually — no availability" });
    await recordAutomationRun(s.ctx, AUTOMATION_KEYS.bookingOffer, s.lead.id, "failed", undefined, "No availability");
    return;
  }
  const sent = await composeAndSend(s, {
    purpose: "booking_offer",
    automationKey: AUTOMATION_KEYS.bookingOffer,
    knowledgeAnswer: opts.knowledgeAnswer ?? null,
    slots,
    eventTitle: `Booking Agent offered ${slots.length} appointment times`,
    authorType: opts.forced ? "staff" : "ai",
  });
  if (!sent) return;
  await patchLead(s, {
    stage: "booking",
    nextAction: "Waiting for the customer to pick a time",
    bookingState: { ...s.lead.bookingState, offeredSlots: slots, offeredAt: new Date().toISOString() },
    automationState: { ...s.lead.automationState, pendingField: null },
  });
  await event(s, {
    type: "booking_offered",
    actor: "agent",
    actorLabel: "Booking Agent",
    title: `Offered ${slots.map((x) => x.label).join(", ")}`,
    receipt: receipt({ headline: "Times come from the calendar provider", reasons: slots.map((x) => `${x.id}) ${x.label}`), nextAction: "Book the time the customer picks" }),
  });
  await recordAutomationRun(s.ctx, AUTOMATION_KEYS.bookingOffer, s.lead.id, "succeeded", `${slots.length} times offered`);
  await scheduleFollowUps(s, sent);
}

export async function bookSlot(s: WorkflowState, slot: OfferedSlot, createdBy: "agent" | "staff"): Promise<boolean> {
  const appt = await tools.createAppointment(s.ctx, { leadId: s.lead.id, startsAt: slot.startsAt, endsAt: slot.endsAt, createdBy });
  if (!appt.ok) {
    if (appt.error === new SlotUnavailableError().message) {
      await event(s, { type: "error", actor: "system", actorLabel: "Booking Agent", title: "That time was just taken — offering new times" });
      await patchLead(s, { bookingState: {} });
      await offerBooking(s, {});
      return false;
    }
    throw new Error(appt.error);
  }
  await tools.cancelFollowUps(s.ctx, { leadId: s.lead.id, reason: "booked" });
  await patchLead(s, {
    stage: "booked",
    nextAction: `Appointment ${slot.label}`,
    nextActionAt: new Date(slot.startsAt),
    bookingState: { ...s.lead.bookingState, appointmentId: appt.data.id, offeredSlots: undefined },
    automationState: { ...s.lead.automationState, pendingField: null },
  });
  await event(s, {
    type: "appointment_created",
    actor: createdBy === "agent" ? "agent" : "staff",
    actorLabel: createdBy === "agent" ? "Booking Agent" : "Team",
    title: `Appointment created — ${slot.label}`,
    receipt: receipt({ headline: "Booked on the calendar", reasons: [s.settings.booking.appointmentLabel, `${s.settings.booking.durationMinutes} minutes`, s.lead.address ?? s.lead.location ?? "Location to confirm"], nextAction: "Confirm with the customer and notify the owner" }),
  });
  if (await isAutomationEnabled(s.ctx, AUTOMATION_KEYS.appointmentConfirmation)) {
    await composeAndSend(s, { purpose: "booking_confirmation", automationKey: AUTOMATION_KEYS.appointmentConfirmation, appointmentLabel: slot.label, eventTitle: "Confirmation sent to the customer", authorType: createdBy === "staff" ? "staff" : "ai" });
    await recordAutomationRun(s.ctx, AUTOMATION_KEYS.appointmentConfirmation, s.lead.id, "succeeded", slot.label);
  }
  await tools.notifyOwner(s.ctx, { leadId: s.lead.id, type: "appointment", priority: "high", title: `Booked: ${s.lead.name ?? "New lead"} — ${slot.label}`, body: s.lead.summary ?? undefined });
  await event(s, { type: "owner_notified", actor: "system", actorLabel: "Signal", title: "Owner notified of the new appointment" });
  return true;
}

export async function performHandoff(s: WorkflowState, priority: "low" | "normal" | "high" | "urgent", reason: string, ownerSummary: string, runId: string | null) {
  if (await isAutomationEnabled(s.ctx, AUTOMATION_KEYS.humanEscalation)) {
    await composeAndSend(s, { purpose: "handoff_holding", automationKey: AUTOMATION_KEYS.humanEscalation, eventTitle: "Let the customer know a person will follow up" });
  }
  must(await tools.requestHumanHandoff(s.ctx, { leadId: s.lead.id, priority, reason, ownerSummary }));
  s.lead = must(await tools.getLead(s.ctx, { leadId: s.lead.id }));
  await event(s, {
    type: "handoff_requested",
    actor: "agent",
    actorLabel: "Handoff Agent",
    title: `Handed off to the team — ${reason}`,
    agentRunId: runId,
    receipt: receipt({ headline: `${priority[0].toUpperCase()}${priority.slice(1)} priority`, reasons: [reason, ownerSummary], nextAction: "Automation paused until a team member returns control" }),
  });
  await recordAutomationRun(s.ctx, AUTOMATION_KEYS.humanEscalation, s.lead.id, "succeeded", reason);
}

interface ComposeOptions {
  purpose: DraftPurpose;
  automationKey: AutomationKey;
  eventTitle: string;
  nextQuestion?: string | null;
  knowledgeAnswer?: string | null;
  unansweredQuestion?: string | null;
  slots?: OfferedSlot[];
  appointmentLabel?: string | null;
  authorType?: "ai" | "staff";
}

/** Drafting Agent → central outbound messaging service → timeline event. */
export async function composeAndSend(s: WorkflowState, o: ComposeOptions): Promise<Message | null> {
  const lastInbound = [...s.msgs].reverse().find((m) => m.direction === "inbound");
  const firstAutomated = !s.msgs.some((m) => m.direction === "outbound" && m.authorType === "ai" && (m.status === "sent" || m.status === "simulated"));
  const draft = await run(s, draftingAgent, {
    business: s.business,
    purpose: o.purpose,
    channel: s.lead.preferredChannel,
    leadFirstName: firstName(s.lead.name),
    serviceRequested: s.lead.serviceRequested,
    location: s.lead.location,
    urgency: s.lead.urgency,
    knowledgeAnswer: o.knowledgeAnswer ?? null,
    unansweredQuestion: o.unansweredQuestion ?? null,
    nextQuestion: o.nextQuestion ?? null,
    slots: o.slots ?? [],
    appointmentLabel: o.appointmentLabel ?? null,
    lastCustomerMessage: lastInbound?.body ?? null,
    conversationExcerpt: transcriptExcerpt(s.msgs, s.settings.businessName, 6),
    includeOptOut: firstAutomated,
  });
  const result = await tools.sendMessage(s.ctx, {
    leadId: s.lead.id,
    body: draft.output.message,
    authorType: o.authorType ?? "ai",
    automationKey: o.authorType === "staff" ? null : o.automationKey,
    idempotencyKey: `wf:${s.sourceMessageId}:${o.purpose}`,
    metadata: { purpose: o.purpose, agentRunId: draft.runId, generatedBy: draft.heuristic ? "heuristic" : draft.model },
  });
  if (!result.ok) {
    await event(s, { type: "message_failed", actor: "system", actorLabel: "Messaging", title: "Couldn't send message", detail: result.error });
    await recordAutomationRun(s.ctx, o.automationKey, s.lead.id, "failed", undefined, result.error);
    return null;
  }
  const r = result.data;
  if (r.status === "blocked") {
    await event(s, { type: "message_blocked", actor: "system", actorLabel: "Message safety", title: "Message held back", detail: BLOCK_REASON_LABELS[r.reason] });
    await recordAutomationRun(s.ctx, o.automationKey, s.lead.id, "skipped", BLOCK_REASON_LABELS[r.reason]);
    return null;
  }
  if (r.status === "failed") {
    await event(s, { type: "message_failed", actor: "system", actorLabel: "Messaging", title: "Message failed to send", detail: r.error });
    await recordAutomationRun(s.ctx, o.automationKey, s.lead.id, "failed", undefined, r.error);
    return null;
  }
  s.msgs = await listMessages(s.ctx, s.lead.id);
  if (r.status !== "duplicate") {
    await event(s, {
      type: "message_sent",
      actor: "agent",
      actorLabel: "Signal",
      title: o.eventTitle,
      detail: r.message.body,
      agentRunId: draft.runId,
    });
    if (o.automationKey === AUTOMATION_KEYS.newLead) await recordAutomationRun(s.ctx, o.automationKey, s.lead.id, "succeeded", `Sent via ${r.message.channel}`);
  }
  s.lead = must(await tools.getLead(s.ctx, { leadId: s.lead.id }));
  return r.message;
}

async function scheduleFollowUps(s: WorkflowState, anchor: Message) {
  const result = await tools.scheduleFollowUp(s.ctx, { leadId: s.lead.id, conversationId: s.conversation.id, anchorMessageId: anchor.id, anchorAt: anchor.sentAt ?? anchor.createdAt });
  if (result.ok && result.data.length) {
    const steps = s.settings.followUpSequence.map((x) => (x.delayHours % 24 === 0 ? `${x.delayHours / 24}d` : `${x.delayHours}h`));
    await event(s, {
      type: "follow_up_scheduled",
      actor: "agent",
      actorLabel: "Follow-Up Agent",
      title: `Follow-ups scheduled (+${steps.join(", +")}) if no reply`,
      receipt: receipt({ headline: "Sequence stops the moment they reply", reasons: ["Lead hasn't replied yet", "Consent on file", "Autopilot on"] }),
    });
  }
}

/** Re-summarise only when the conversation actually changed (cost control). */
async function refreshSummary(s: WorkflowState) {
  const count = s.msgs.length;
  if ((s.lead.automationState.lastSummaryMessageCount ?? 0) === count) return;
  const inbound = s.msgs.filter((m) => m.direction === "inbound").length;
  if (inbound < 2) {
    await patchLead(s, { automationState: { ...s.lead.automationState, lastSummaryMessageCount: count } });
    return; // the Intake Agent's summary is still current
  }
  const out = await run(s, summaryAgent, {
    businessName: s.settings.businessName,
    leadName: s.lead.name,
    facts: {
      service: s.lead.serviceRequested,
      location: s.lead.location,
      timeline: s.lead.timeline,
      budget: s.lead.budget,
      status: s.lead.nextAction ? `Next: ${s.lead.nextAction}.` : null,
    },
    transcript: transcriptExcerpt(s.msgs, s.settings.businessName, 12),
  });
  await patchLead(s, { summary: out.output.summary, automationState: { ...s.lead.automationState, lastSummaryMessageCount: count } });
}
