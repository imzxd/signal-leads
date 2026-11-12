import type { Temperature } from "@/types/domain";
import type { ScoreFactor, ScoreResult, ScoringInput, ScoringWeights } from "./types";

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  base: 10,
  serviceSupported: 15,
  serviceUnsupported: -25,
  inServiceArea: 15,
  outsideServiceArea: -30,
  urgencyEmergency: 15,
  urgencyUrgent: 12,
  urgencySoon: 7,
  urgencyFlexible: 2,
  intentHigh: 20,
  intentMedium: 10,
  intentLow: 0,
  intentNone: -10,
  completenessMax: 12,
  contactable: 5,
  replied: 6,
  repliedMultiple: 4,
  existingCustomer: 5,
  priceShopper: -8,
  spamCap: 5,
};

export function resolveWeights(overrides: Partial<ScoringWeights> | null | undefined): ScoringWeights {
  const merged = { ...DEFAULT_SCORING_WEIGHTS };
  if (!overrides) return merged;
  for (const [key, value] of Object.entries(overrides)) {
    if (key in merged && typeof value === "number" && Number.isFinite(value)) {
      merged[key as keyof ScoringWeights] = value;
    }
  }
  return merged;
}

/** Spec thresholds: 0–29 cold, 30–59 warm, 60–79 qualified, 80–100 hot. */
export function temperatureForScore(score: number): Temperature {
  if (score >= 80) return "hot";
  if (score >= 60) return "qualified";
  if (score >= 30) return "warm";
  return "cold";
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Deterministic, explainable lead score. The AI never sets the number directly;
 * it only contributes the semantic signals inside `input.signals`.
 */
export function computeLeadScore(input: ScoringInput, weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS): ScoreResult {
  const factors: ScoreFactor[] = [];
  const add = (key: string, label: string, points: number) => {
    if (points === 0) return;
    factors.push({ key, label, points, kind: points > 0 ? "positive" : "negative" });
  };

  let total = weights.base;

  if (input.serviceSupported === "yes") add("service_supported", "Requested service is offered", weights.serviceSupported);
  if (input.serviceSupported === "no") add("service_unsupported", "Requested service is not offered", weights.serviceUnsupported);

  if (input.inServiceArea === "yes") add("in_area", "Inside the service area", weights.inServiceArea);
  if (input.inServiceArea === "no") add("outside_area", "Outside the service area", weights.outsideServiceArea);

  const urgencyPoints: Record<string, [number, string]> = {
    emergency: [weights.urgencyEmergency, "Emergency — needs help now"],
    urgent: [weights.urgencyUrgent, "Urgent requirement"],
    soon: [weights.urgencySoon, "Needs work soon"],
    flexible: [weights.urgencyFlexible, "Flexible timeline"],
  };
  const urgency = urgencyPoints[input.urgency];
  if (urgency) add(`urgency_${input.urgency}`, urgency[1], urgency[0]);

  const intentPoints: Record<string, [number, string]> = {
    high: [weights.intentHigh, "Clear buying intent"],
    medium: [weights.intentMedium, "Moderate buying intent"],
    low: [weights.intentLow, "Low buying intent"],
    none: [weights.intentNone, "No real buying intent"],
  };
  const intent = intentPoints[input.signals.buyingIntent];
  if (intent) add(`intent_${input.signals.buyingIntent}`, intent[1], intent[0]);

  if (input.requiredFieldsTotal > 0) {
    const ratio = input.requiredFieldsKnown / input.requiredFieldsTotal;
    const pts = Math.round(weights.completenessMax * ratio);
    add(
      "completeness",
      ratio >= 1 ? "All required details provided" : `${input.requiredFieldsKnown}/${input.requiredFieldsTotal} required details provided`,
      pts,
    );
  }

  if (input.hasContactMethod) add("contactable", "Reachable contact details", weights.contactable);
  if (input.inboundReplies >= 1) add("responsive", "Responsive prospect", weights.replied);
  if (input.inboundReplies >= 3) add("very_responsive", "Engaged in conversation", weights.repliedMultiple);
  if (input.isExistingCustomer) add("existing_customer", "Existing customer", weights.existingCustomer);
  if (input.signals.isPriceShopper) add("price_shopper", "Mainly comparing prices", weights.priceShopper);

  total += factors.reduce((sum, f) => sum + f.points, 0);

  if (input.signals.isSpam) {
    factors.push({ key: "spam", label: "Looks like spam or a fake inquiry", points: Math.min(0, weights.spamCap - total), kind: "negative" });
    total = Math.min(total, weights.spamCap);
  }

  const score = clamp(total);
  return { score, temperature: temperatureForScore(score), factors, explanation: explainScore(factors) };
}

/** Owner-friendly one-sentence explanation built from the strongest factors. */
export function explainScore(factors: ScoreFactor[]): string {
  if (factors.some((f) => f.key === "spam")) return "Likely spam or a fake inquiry — automation will not pursue it.";
  const sorted = [...factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const positives = sorted.filter((f) => f.kind === "positive").slice(0, 3).map((f) => lowerFirst(f.label));
  const negatives = sorted.filter((f) => f.kind === "negative").slice(0, 2).map((f) => lowerFirst(f.label));
  const parts: string[] = [];
  if (positives.length) parts.push(capitalize(joinList(positives)));
  if (negatives.length) parts.push(`${positives.length ? "but " : ""}${joinList(negatives)}`);
  return parts.length ? `${parts.join(", ")}.` : "Not enough information yet to judge this lead.";
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Difference of two factor sets, used for "Score increased +18" receipts. */
export function diffFactors(previous: ScoreFactor[], next: ScoreFactor[]): { gained: ScoreFactor[]; lost: ScoreFactor[] } {
  const prevKeys = new Set(previous.map((f) => f.key));
  const nextKeys = new Set(next.map((f) => f.key));
  return {
    gained: next.filter((f) => !prevKeys.has(f.key)),
    lost: previous.filter((f) => !nextKeys.has(f.key)),
  };
}
