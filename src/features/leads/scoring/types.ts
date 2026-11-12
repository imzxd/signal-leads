import type { Temperature, Urgency } from "@/types/domain";

/** Semantic judgements the Scoring Agent (AI) is allowed to make. */
export type BuyingIntent = "high" | "medium" | "low" | "none";
export type TriState = "yes" | "no" | "unknown";

export interface SemanticSignals {
  buyingIntent: BuyingIntent;
  isSpam: boolean;
  isPriceShopper: boolean;
  /** 0..1 — how sure the model is about these semantic signals. */
  confidence: number;
}

/** Facts the deterministic engine evaluates. Everything here is computed in code. */
export interface ScoringInput {
  serviceSupported: TriState;
  inServiceArea: TriState;
  urgency: Urgency;
  requiredFieldsTotal: number;
  requiredFieldsKnown: number;
  hasContactMethod: boolean;
  inboundReplies: number;
  isExistingCustomer: boolean;
  signals: SemanticSignals;
}

export interface ScoringWeights {
  base: number;
  serviceSupported: number;
  serviceUnsupported: number;
  inServiceArea: number;
  outsideServiceArea: number;
  urgencyEmergency: number;
  urgencyUrgent: number;
  urgencySoon: number;
  urgencyFlexible: number;
  intentHigh: number;
  intentMedium: number;
  intentLow: number;
  intentNone: number;
  completenessMax: number;
  contactable: number;
  replied: number;
  repliedMultiple: number;
  existingCustomer: number;
  priceShopper: number;
  spamCap: number;
}

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  kind: "positive" | "negative" | "neutral";
}

export interface ScoreResult {
  score: number;
  temperature: Temperature;
  factors: ScoreFactor[];
  explanation: string;
}
