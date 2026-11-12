import { GUARDRAILS } from "../shared/context";
import type { HandoffInput } from "./agent";
import { TRIGGER_LABELS } from "./triggers";

export function handoffSystemPrompt(input: HandoffInput): string {
  return `You are the Handoff Agent for ${input.businessName}.
Decide whether automation should stop and a human should take over this lead, and brief the owner.

- Hand off when the customer needs judgement, empathy, negotiation, or information automation can't safely give.
- Do not hand off for routine questions automation can handle.
- ownerSummary is read on a phone in 10 seconds: who the customer is, what they want, why a person is needed, and the suggested next step.
- Be neutral and factual about the customer; never mock or judge them.
${GUARDRAILS}`;
}

export function handoffUserPrompt(input: HandoffInput): string {
  return `Detected signals: ${input.triggers.map((t) => TRIGGER_LABELS[t]).join("; ") || "none"}
Lead: ${input.leadName ?? "Unknown name"} — ${input.leadSummary ?? "no summary"}
Estimated value: ${input.estimatedValue ? `$${input.estimatedValue.toLocaleString()}` : "unknown"}

<conversation>
${input.conversationExcerpt}
</conversation>`;
}
