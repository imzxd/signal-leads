import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { QualificationField } from "@/types/domain";
import { clamp01, type BusinessProfile } from "../shared/context";
import { qualificationSystemPrompt, qualificationUserPrompt } from "./prompt";
import { qualificationOutputSchema, type QualificationOutput } from "./schema";

/** Values known about a lead, keyed by standard field key or custom qualification key. */
export type KnownFields = Record<string, string | null | undefined>;

export interface QualificationInput {
  business: BusinessProfile;
  serviceKey: string | null;
  known: KnownFields;
  /** Deterministically computed — the model never decides what is missing. */
  missing: QualificationField[];
  askCounts: Record<string, number>;
  conversationExcerpt: string;
}

/** Fields that apply to this lead's service. */
export function applicableFields(fields: QualificationField[], serviceKey: string | null): QualificationField[] {
  return fields.filter((f) => !f.services?.length || (serviceKey !== null && f.services.includes(serviceKey)));
}

export function isFieldKnown(key: string, known: KnownFields): boolean {
  const has = (k: string) => Boolean(known[k] && String(known[k]).trim());
  switch (key) {
    case "contact":
      return has("email") || has("phone");
    case "service":
      return has("service") || has("service_key");
    case "location":
      return has("location") || has("address");
    case "urgency":
      return has("urgency") && known.urgency !== "unknown";
    default:
      return has(key);
  }
}

export function computeMissingFields(fields: QualificationField[], serviceKey: string | null, known: KnownFields): QualificationField[] {
  return applicableFields(fields, serviceKey).filter((f) => !isFieldKnown(f.key, known));
}

/** A field asked twice without an answer is parked so we don't interrogate the customer. */
const MAX_ASKS_PER_FIELD = 2;

export function qualificationHeuristic(input: QualificationInput): QualificationOutput {
  const askable = input.missing.filter((f) => (input.askCounts[f.key] ?? 0) < MAX_ASKS_PER_FIELD);
  const requiredMissing = input.missing.filter((f) => f.required);
  const target = askable.find((f) => f.required) ?? askable.find((f) => !f.required) ?? null;
  return {
    qualificationComplete: requiredMissing.length === 0,
    missingFields: input.missing.map((f) => f.key),
    targetField: target?.key ?? null,
    nextQuestion: target?.question ?? null,
    reasonCode: !target ? "complete" : target.required ? "missing_required" : "missing_optional",
    confidence: 0.8,
  };
}

export function normalizeQualification(output: QualificationOutput, input: QualificationInput): QualificationOutput {
  const deterministic = qualificationHeuristic(input);
  const askableKeys = new Set(input.missing.filter((f) => (input.askCounts[f.key] ?? 0) < MAX_ASKS_PER_FIELD).map((f) => f.key));
  const targetValid = output.targetField !== null && askableKeys.has(output.targetField);
  const question = targetValid && output.nextQuestion?.trim() ? output.nextQuestion.trim().slice(0, 240) : deterministic.nextQuestion;
  return {
    // Completeness and the missing list are facts, computed in code.
    qualificationComplete: deterministic.qualificationComplete,
    missingFields: deterministic.missingFields,
    targetField: targetValid ? output.targetField : deterministic.targetField,
    nextQuestion: (targetValid ? output.targetField : deterministic.targetField) ? question : null,
    reasonCode: deterministic.reasonCode === "complete" ? "complete" : output.reasonCode === "complete" ? deterministic.reasonCode : output.reasonCode,
    confidence: clamp01(output.confidence),
  };
}

export const qualificationAgent: AgentDefinition<QualificationInput, QualificationOutput> = {
  type: "qualification",
  schema: qualificationOutputSchema,
  system: qualificationSystemPrompt,
  prompt: qualificationUserPrompt,
  heuristic: qualificationHeuristic,
  normalize: normalizeQualification,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ serviceKey: i.serviceKey, missing: i.missing.map((f) => f.key), askCounts: i.askCounts }),
};

/**
 * Only spend a model call when there is a real choice to make: when nothing (or exactly one
 * askable field) is missing, the deterministic answer is already optimal.
 */
export function qualificationNeedsModel(input: QualificationInput): boolean {
  const askable = input.missing.filter((f) => (input.askCounts[f.key] ?? 0) < MAX_ASKS_PER_FIELD);
  return askable.length > 1;
}
