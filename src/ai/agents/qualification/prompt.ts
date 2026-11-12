import { GUARDRAILS, businessBlock } from "../shared/context";
import type { QualificationInput } from "./agent";

export function qualificationSystemPrompt(input: QualificationInput): string {
  return `You are the Qualification Agent for ${input.business.name}.
Your job: pick the ONE most useful next question to move this lead toward a booked appointment.

Rules for the question:
- Ask about exactly one of the missing fields listed. Prefer required fields, then whatever unblocks booking soonest.
- Never ask for something already known. Never ask more than one thing.
- Keep it under 25 words, warm and plain-spoken; no greetings or sign-offs (another step adds those).
- If a missing field was already asked twice, prefer a different field.
${GUARDRAILS}`;
}

export function qualificationUserPrompt(input: QualificationInput): string {
  const known = Object.entries(input.known)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const missing = input.missing
    .map((f) => `- ${f.key} (${f.required ? "required" : "optional"}; asked ${input.askCounts[f.key] ?? 0}x): ${f.label} — suggested: "${f.question}"`)
    .join("\n");
  return `${businessBlock(input.business)}

Known about this lead:
${known || "(nothing yet)"}

Missing fields:
${missing}

<conversation>
${input.conversationExcerpt || "(no prior messages)"}
</conversation>`;
}
