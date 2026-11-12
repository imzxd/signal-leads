import type { EscalationRules, Priority } from "@/types/domain";
import { asksForHuman, detectLegalThreat, detectSentiment, escapeRegExp, type Sentiment } from "../shared/text-signals";

export type HandoffTrigger =
  | "explicit_human_request"
  | "legal_threat"
  | "angry_customer"
  | "negative_sentiment"
  | "pricing_dispute"
  | "low_ai_confidence"
  | "vip_lead"
  | "unsupported_request"
  | "outside_service_area"
  | "unanswered_question"
  | "repeated_model_failure"
  | "business_rule";

export interface TriggerInput {
  text: string;
  sentiment?: Sentiment;
  aiConfidence: number | null;
  estimatedValue: number | null;
  serviceSupported: "yes" | "no" | "unknown";
  inServiceArea: "yes" | "no" | "unknown";
  unansweredQuestion: boolean;
  consecutiveFallbacks: number;
  rules: EscalationRules;
}

export const TRIGGER_PRIORITY: Record<HandoffTrigger, Priority> = {
  legal_threat: "urgent",
  angry_customer: "high",
  explicit_human_request: "high",
  vip_lead: "high",
  pricing_dispute: "high",
  negative_sentiment: "normal",
  repeated_model_failure: "normal",
  low_ai_confidence: "normal",
  unanswered_question: "normal",
  business_rule: "normal",
  unsupported_request: "low",
  outside_service_area: "low",
};

/** Triggers that always force a handoff — the model cannot override these. */
export const HARD_TRIGGERS: readonly HandoffTrigger[] = ["explicit_human_request", "legal_threat", "angry_customer", "business_rule", "vip_lead"];

export const TRIGGER_LABELS: Record<HandoffTrigger, string> = {
  explicit_human_request: "Customer asked for a person",
  legal_threat: "Legal threat mentioned",
  angry_customer: "Customer is upset",
  negative_sentiment: "Negative sentiment",
  pricing_dispute: "Pricing dispute",
  low_ai_confidence: "Low AI confidence",
  vip_lead: "High-value lead",
  unsupported_request: "Service not offered",
  outside_service_area: "Outside service area",
  unanswered_question: "Question not covered by knowledge base",
  repeated_model_failure: "Repeated AI failures",
  business_rule: "Matched an escalation keyword",
};

export function detectHandoffTriggers(input: TriggerInput): HandoffTrigger[] {
  const t = input.text;
  const triggers: HandoffTrigger[] = [];
  const sentiment = input.sentiment ?? detectSentiment(t);
  if (asksForHuman(t)) triggers.push("explicit_human_request");
  if (detectLegalThreat(t)) triggers.push("legal_threat");
  if (sentiment === "angry") triggers.push("angry_customer");
  else if (sentiment === "negative") triggers.push("negative_sentiment");
  if (/\b(overcharg|too expensive|price (is|was) (too|way)|refund|charged (me )?(twice|too much)|dispute|invoice (is )?wrong)\w*/i.test(t)) triggers.push("pricing_dispute");
  if (input.aiConfidence !== null && input.aiConfidence < input.rules.minConfidence) triggers.push("low_ai_confidence");
  if (input.rules.vipValueThreshold && input.estimatedValue && input.estimatedValue >= input.rules.vipValueThreshold) triggers.push("vip_lead");
  if (input.serviceSupported === "no") triggers.push("unsupported_request");
  if (input.inServiceArea === "no") triggers.push("outside_service_area");
  if (input.unansweredQuestion) triggers.push("unanswered_question");
  if (input.consecutiveFallbacks >= 3) triggers.push("repeated_model_failure");
  const kw = input.rules.keywords.find((k) => k.trim() && new RegExp(`\\b${escapeRegExp(k.trim().toLowerCase())}\\b`).test(t.toLowerCase()));
  if (kw) triggers.push("business_rule");
  return triggers;
}

export function highestPriority(triggers: HandoffTrigger[]): Priority {
  const order: Priority[] = ["urgent", "high", "normal", "low"];
  for (const p of order) if (triggers.some((t) => TRIGGER_PRIORITY[t] === p)) return p;
  return "low";
}

export const DEFAULT_ESCALATION_RULES: EscalationRules = {
  keywords: ["insurance adjuster", "commercial contract", "property manager"],
  vipValueThreshold: 25000,
  minConfidence: 0.45,
};
