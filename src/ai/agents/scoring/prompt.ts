import { GUARDRAILS, businessBlock } from "../shared/context";
import type { ScoringAgentInput } from "./agent";

export function scoringSystemPrompt(input: ScoringAgentInput): string {
  return `You are the Lead Scoring Agent for ${input.business.name}.
You classify three semantic signals. You do NOT produce a score — the scoring engine computes it from your signals plus business rules.

- buyingIntent: high = wants the work done and is ready to book; medium = interested but exploring; low = vague or distant; none = not a real customer request.
- isSpam: true only for spam, vendor pitches, gibberish or clearly fake inquiries.
- isPriceShopper: true when the customer mainly wants a price comparison and shows little intent to book.
${GUARDRAILS}`;
}

export function scoringUserPrompt(input: ScoringAgentInput): string {
  return `${businessBlock(input.business)}

Lead summary: ${input.summary ?? "(none)"}
Service: ${input.serviceRequested ?? "unknown"} | Urgency: ${input.urgency} | Timeline: ${input.timeline ?? "unknown"}

<conversation>
${input.conversationExcerpt}
</conversation>`;
}
