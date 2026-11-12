import type { AgentDefinition } from "@/ai/runtime/run-agent";
import { clamp01 } from "../shared/context";
import { truncate } from "../shared/text-signals";
import { handoffSystemPrompt, handoffUserPrompt } from "./prompt";
import { handoffOutputSchema, type HandoffOutput } from "./schema";
import { HARD_TRIGGERS, TRIGGER_LABELS, TRIGGER_PRIORITY, highestPriority, type HandoffTrigger } from "./triggers";

export interface HandoffInput {
  businessName: string;
  triggers: HandoffTrigger[];
  leadName: string | null;
  leadSummary: string | null;
  estimatedValue: number | null;
  lastMessage: string;
  conversationExcerpt: string;
}

export function handoffHeuristic(input: HandoffInput): HandoffOutput {
  const required = input.triggers.some((t) => TRIGGER_PRIORITY[t] !== "low" || HARD_TRIGGERS.includes(t)) || input.triggers.length >= 2;
  const primary = [...input.triggers].sort((a, b) => rank(TRIGGER_PRIORITY[a]) - rank(TRIGGER_PRIORITY[b]))[0];
  const who = input.leadName ?? "A new lead";
  const reason = primary ? TRIGGER_LABELS[primary] : "No escalation needed";
  return {
    handoffRequired: required,
    priority: highestPriority(input.triggers),
    reason,
    ownerSummary: required
      ? `${who}: ${input.leadSummary ?? "new inquiry"}. ${reason}. Latest message: "${truncate(input.lastMessage.trim(), 140)}" — please reply personally.`
      : `${who}: ${input.leadSummary ?? "new inquiry"}. No human action needed yet.`,
    confidence: 0.75,
  };
}

const rank = (p: string) => ["urgent", "high", "normal", "low"].indexOf(p);

export function normalizeHandoff(o: HandoffOutput, input: HandoffInput): HandoffOutput {
  const hard = input.triggers.some((t) => HARD_TRIGGERS.includes(t));
  const floor = highestPriority(input.triggers);
  return {
    handoffRequired: hard || o.handoffRequired,
    // The model may raise priority but never lower it below the deterministic floor.
    priority: hard && rank(o.priority) > rank(floor) ? floor : o.priority,
    reason: truncate(o.reason.trim() || "Needs a human", 90),
    ownerSummary: truncate(o.ownerSummary.trim(), 480),
    confidence: clamp01(o.confidence),
  };
}

export const handoffAgent: AgentDefinition<HandoffInput, HandoffOutput> = {
  type: "handoff",
  schema: handoffOutputSchema,
  system: handoffSystemPrompt,
  prompt: handoffUserPrompt,
  heuristic: handoffHeuristic,
  normalize: normalizeHandoff,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ triggers: i.triggers, lastMessage: i.lastMessage }),
};
