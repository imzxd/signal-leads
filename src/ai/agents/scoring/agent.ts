import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { Urgency } from "@/types/domain";
import { computeLeadScore, resolveWeights } from "@/features/leads/scoring/engine";
import type { ScoreResult, ScoringInput, ScoringWeights } from "@/features/leads/scoring/types";
import { clamp01, type BusinessProfile } from "../shared/context";
import { detectNotInterested, detectPriceShopping, detectSpam } from "../shared/text-signals";
import { scoringSystemPrompt, scoringUserPrompt } from "./prompt";
import { scoringSignalsSchema, type ScoringSignals } from "./schema";

export interface ScoringAgentInput {
  business: BusinessProfile;
  summary: string | null;
  serviceRequested: string | null;
  urgency: Urgency;
  timeline: string | null;
  /** Inbound customer messages, newest last. */
  conversationExcerpt: string;
  inboundText: string;
}

export function scoringHeuristic(input: ScoringAgentInput): ScoringSignals {
  const text = input.inboundText;
  const spam = detectSpam(text);
  const notInterested = detectNotInterested(text);
  const strong = /\b(book|schedule|come (out|by|today|tomorrow)|send someone|need (it|this) (done|fixed)|ready to|go ahead|when can you|estimate|quote)\b/i.test(text);
  const exploring = /\b(thinking about|considering|planning|curious|wondering|just looking|maybe)\b/i.test(text);
  let buyingIntent: ScoringSignals["buyingIntent"] = "medium";
  if (spam || notInterested) buyingIntent = "none";
  else if (strong || input.urgency === "emergency" || input.urgency === "urgent") buyingIntent = "high";
  else if (exploring || input.urgency === "flexible") buyingIntent = "low";
  return {
    buyingIntent,
    isSpam: spam,
    isPriceShopper: detectPriceShopping(text) && buyingIntent !== "high",
    confidence: 0.7,
  };
}

export const scoringAgent: AgentDefinition<ScoringAgentInput, ScoringSignals> = {
  type: "scoring",
  schema: scoringSignalsSchema,
  system: scoringSystemPrompt,
  prompt: scoringUserPrompt,
  heuristic: scoringHeuristic,
  normalize: (o, input) => ({
    ...o,
    // Obvious spam patterns are a deterministic floor the model can't talk us out of.
    isSpam: o.isSpam || detectSpam(input.inboundText),
    confidence: clamp01(o.confidence),
  }),
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ summary: i.summary, urgency: i.urgency, serviceRequested: i.serviceRequested }),
};

/** Combine AI signals with deterministic facts using the configurable engine. */
export function scoreWithSignals(
  facts: Omit<ScoringInput, "signals">,
  signals: ScoringSignals,
  weights?: Partial<ScoringWeights>,
): ScoreResult {
  return computeLeadScore({ ...facts, signals }, resolveWeights(weights));
}
