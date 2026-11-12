import { afterEach, describe, expect, it } from "vitest";
import { runAgent } from "@/ai/runtime/run-agent";
import { setAIProviderForTesting, type AIProvider } from "@/ai/providers";
import { intakeAgent, intakeHeuristic, normalizeIntake } from "@/ai/agents/intake/agent";
import { intakeOutputSchema } from "@/ai/agents/intake/schema";
import { qualificationAgent, computeMissingFields, qualificationNeedsModel } from "@/ai/agents/qualification/agent";
import { knowledgeHeuristic, normalizeKnowledge } from "@/ai/agents/knowledge/agent";
import { handoffHeuristic, normalizeHandoff } from "@/ai/agents/handoff/agent";
import { detectHandoffTriggers, DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import { draftHeuristic, finalizeDraft, type DraftInput } from "@/ai/agents/drafting/agent";
import { replyParserHeuristic } from "@/ai/agents/reply-parser/agent";
import { bookingAgent } from "@/ai/agents/booking/agent";
import { ModelOutputError } from "@/ai/providers/types";
import { DEMO_QUALIFICATION_FIELDS, DEMO_SERVICE_AREA, DEMO_SERVICES } from "@/server/seed/demo-config";
import type { BusinessProfile } from "@/ai/agents/shared/context";

const business: BusinessProfile = {
  name: "Evergreen Roofing",
  industry: "Roofing",
  brandVoice: null,
  phone: null,
  timezone: "America/Toronto",
  services: DEMO_SERVICES,
  serviceArea: DEMO_SERVICE_AREA,
  qualificationFields: DEMO_QUALIFICATION_FIELDS,
};

/** A fake "live" provider so we can test the runtime's validation, retry and fallback paths. */
function fakeProvider(behaviour: () => unknown): AIProvider & { calls: number } {
  const p = {
    id: "fake",
    live: true,
    calls: 0,
    async generateStructuredObject() {
      p.calls++;
      const out = behaviour();
      if (out instanceof Error) throw out;
      return { output: out, model: "fake-model", usage: { inputTokens: 10, outputTokens: 5 } };
    },
    async generateMessage() {
      throw new Error("unused");
    },
    async summarize() {
      throw new Error("unused");
    },
  };
  return p as never;
}

afterEach(() => setAIProviderForTesting(null));

describe("agent runtime: never trust raw model JSON", () => {
  const input = { business, message: "My roof is leaking in Guelph, can someone come this week?", source: "form" as const, form: { name: "Sam" } };

  it("uses valid model output and records it as succeeded", async () => {
    const valid = intakeHeuristic(input);
    setAIProviderForTesting(fakeProvider(() => ({ ...valid, summary: "From the model" })));
    const out = await runAgent(intakeAgent, input);
    expect(out.status).toBe("succeeded");
    expect(out.heuristic).toBe(false);
    expect(out.output.summary).toBe("From the model");
  });

  it("retries once on schema-invalid output, then falls back deterministically", async () => {
    const provider = fakeProvider(() => ({ intent: 42, confidence: "high" }));
    setAIProviderForTesting(provider);
    const out = await runAgent(intakeAgent, input);
    expect(provider.calls).toBe(2);
    expect(out.status).toBe("fallback");
    expect(out.fellBack).toBe(true);
    expect(intakeOutputSchema.safeParse(out.output).success).toBe(true);
    expect(out.output.serviceKey).toBe("roof_repair");
  });

  it("does not retry refusals, but still produces a usable answer", async () => {
    const provider = fakeProvider(() => new ModelOutputError("Model declined", false));
    setAIProviderForTesting(provider);
    const out = await runAgent(intakeAgent, input);
    expect(provider.calls).toBe(1);
    expect(out.status).toBe("fallback");
  });

  it("strips hallucinated service keys and unknown qualification fields", () => {
    const raw = { ...intakeHeuristic(input), serviceKey: "solar_install", fields: [{ key: "favourite_colour", value: "blue" }, { key: "address", value: "1 Main St" }] };
    const n = normalizeIntake(raw, input);
    expect(n.serviceKey).toBeNull();
    expect(n.fields).toEqual([{ key: "address", value: "1 Main St" }]);
  });

  it("booking agent can only select slots that were actually offered", async () => {
    setAIProviderForTesting(fakeProvider(() => ({ selectedSlotId: "9", wantsDifferentTimes: false, confidence: 0.9 })));
    const out = await runAgent(bookingAgent, { businessName: "X", reply: "the later one", offeredSlots: [{ id: "1", startsAt: "", endsAt: "", label: "Thu · 10:00 AM" }] });
    expect(out.output.selectedSlotId).toBeNull();
  });
});

describe("qualification agent", () => {
  it("computes missing fields deterministically and only spends a model call when there is a choice", () => {
    const missing = computeMissingFields(DEMO_QUALIFICATION_FIELDS, "roof_repair", { timeline: "this week" });
    expect(missing.map((f) => f.key)).toEqual(["address", "property_type", "roof_age"]);
    expect(qualificationNeedsModel({ business, serviceKey: "roof_repair", known: {}, missing, askCounts: {}, conversationExcerpt: "" })).toBe(true);
    expect(qualificationNeedsModel({ business, serviceKey: "roof_repair", known: {}, missing: missing.slice(0, 1), askCounts: {}, conversationExcerpt: "" })).toBe(false);
  });

  it("never lets the model mark qualification complete or target an answered field", () => {
    const missing = computeMissingFields(DEMO_QUALIFICATION_FIELDS, "roof_repair", {});
    const qInput = { business, serviceKey: "roof_repair", known: {}, missing, askCounts: {}, conversationExcerpt: "" };
    const n = qualificationAgent.normalize!({ qualificationComplete: true, missingFields: [], targetField: "email", nextQuestion: "What's your email?", reasonCode: "complete", confidence: 0.9 }, qInput);
    expect(n.qualificationComplete).toBe(false);
    expect(n.targetField).toBe("address");
    expect(n.missingFields).toContain("address");
  });

  it("stops asking a field after two unanswered attempts", () => {
    const missing = computeMissingFields(DEMO_QUALIFICATION_FIELDS, "eavestrough", {});
    const out = qualificationAgent.heuristic({ business, serviceKey: "eavestrough", known: {}, missing, askCounts: { address: 2 }, conversationExcerpt: "" });
    expect(out.targetField).toBe("property_type");
  });
});

describe("knowledge agent grounding", () => {
  const chunks = [{ id: "c1", title: "FAQ", content: "FAQ\nQ: Do you offer financing?\nA: Yes, financing is available for replacements over $5,000.", score: 0.8 }];
  it("answers from the knowledge base with a source", () => {
    const out = knowledgeHeuristic({ businessName: "X", question: "Do you have financing options?", chunks });
    expect(out.answerable).toBe(true);
    expect(out.sourceIds).toEqual(["c1"]);
    expect(out.answer).toMatch(/financing is available/);
  });
  it("refuses rather than invents when nothing matches", () => {
    expect(knowledgeHeuristic({ businessName: "X", question: "Do you install solar panels on barns?", chunks }).answerable).toBe(false);
  });
  it("treats any answer without a valid source as unanswerable", () => {
    const n = normalizeKnowledge({ answerable: true, answer: "Our warranty is 50 years", sourceIds: ["made-up"], confidence: 0.95 }, { businessName: "X", question: "warranty?", chunks });
    expect(n.answerable).toBe(false);
    expect(n.answer).toBeNull();
  });
});

describe("handoff agent", () => {
  it("hard triggers always force a handoff, even if the model disagrees", () => {
    const triggers = detectHandoffTriggers({ text: "Let me talk to a real person", aiConfidence: 0.9, estimatedValue: 1000, serviceSupported: "yes", inServiceArea: "yes", unansweredQuestion: false, consecutiveFallbacks: 0, rules: DEFAULT_ESCALATION_RULES });
    const input = { businessName: "X", triggers, leadName: "Sam", leadSummary: "Leak", estimatedValue: 1000, lastMessage: "Let me talk to a real person", conversationExcerpt: "" };
    expect(handoffHeuristic(input).handoffRequired).toBe(true);
    const n = normalizeHandoff({ handoffRequired: false, priority: "low", reason: "fine", ownerSummary: "ok", confidence: 0.9 }, input);
    expect(n.handoffRequired).toBe(true);
    expect(n.priority).toBe("high");
  });
  it("does not escalate routine messages", () => {
    expect(detectHandoffTriggers({ text: "Thanks, sounds good", aiConfidence: 0.9, estimatedValue: 1000, serviceSupported: "yes", inServiceArea: "yes", unansweredQuestion: false, consecutiveFallbacks: 0, rules: DEFAULT_ESCALATION_RULES })).toEqual([]);
  });
});

describe("drafting: availability and compliance text come from code", () => {
  const base: DraftInput = {
    business,
    purpose: "booking_offer",
    channel: "sms",
    leadFirstName: "Sam",
    serviceRequested: "Roof Repair",
    location: "Guelph",
    urgency: "urgent",
    knowledgeAnswer: null,
    unansweredQuestion: null,
    nextQuestion: null,
    slots: [
      { id: "1", startsAt: "", endsAt: "", label: "Thu, Nov 19 · 10:00 AM" },
      { id: "2", startsAt: "", endsAt: "", label: "Fri, Nov 20 · 1:30 PM" },
    ],
    appointmentLabel: null,
    lastCustomerMessage: null,
    conversationExcerpt: "",
    includeOptOut: true,
  };
  it("appends the real slot list and SMS opt-out language even if the model omits them", () => {
    const out = finalizeDraft({ message: "Great news, we can come by!", confidence: 0.9 }, base);
    expect(out.message).toContain("1) Thu, Nov 19 · 10:00 AM");
    expect(out.message).toContain("Reply with 1 or 2");
    expect(out.message).toMatch(/Reply STOP to opt out/);
  });
  it("heuristic first response asks the next question", () => {
    const out = draftHeuristic({ ...base, purpose: "first_response", slots: [], nextQuestion: "What's the address?" });
    expect(out.message).toContain("What's the address?");
  });
});

describe("reply parser heuristic", () => {
  it("assigns a short answer to the pending question", () => {
    const out = replyParserHeuristic({ business, reply: "42 Maple Ave, it's a detached house", pendingField: DEMO_QUALIFICATION_FIELDS[0], allowedFieldKeys: ["address", "property_type", "timeline"], offeredSlots: [], conversationExcerpt: "" });
    expect(out.kind).toBe("answer");
    expect(out.fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "address" }), { key: "property_type", value: "detached" }]));
  });
});
