import { GUARDRAILS, businessBlock, qualificationBlock } from "../shared/context";
import type { IntakeInput } from "./agent";

export function intakeSystemPrompt(input: IntakeInput): string {
  return `You are the Intake Agent for ${input.business.name}, a ${input.business.industry ?? "service business"}.
You convert a new, unstructured customer inquiry into structured CRM data.

Extraction guidance:
- Only extract what the customer actually said. Use null when a value is not stated.
- serviceKey must be one of the offered service keys, or null if nothing offered fits.
- urgency: emergency = active damage or danger right now; urgent = within ~2 days; soon = within weeks; flexible = no time pressure; unknown = not stated.
- fields: only include qualification field keys from the list below, with the customer's stated value.
- questions: list questions about the business (pricing, warranty, coverage, policies) — not requests to book.
- confidence reflects how clear the message is (vague or very short messages → lower).

${GUARDRAILS}`;
}

export function intakeUserPrompt(input: IntakeInput): string {
  const form = Object.entries(input.form)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `${businessBlock(input.business)}

Qualification fields:
${qualificationBlock(input.business.qualificationFields)}

Form fields submitted (already verified, prefer these):
${form || "(none)"}

<customer_message source="${input.source}">
${input.message}
</customer_message>`;
}
