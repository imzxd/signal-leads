import { GUARDRAILS, businessBlock } from "../shared/context";
import type { ReplyParserInput } from "./agent";

export function replyParserSystemPrompt(input: ReplyParserInput): string {
  return `You are the Reply Parser for ${input.business.name}. A customer replied to our last message.
Classify the reply and extract any new facts.

- kind: answer (provides information we asked for), question (asks us something), slot_selection (picks one of the offered appointment options), reschedule (wants different times), not_interested, human_request (wants a person), other.
- fields: only use these keys: ${input.allowedFieldKeys.join(", ")}. Only include values the customer actually stated in THIS reply.
- If we were waiting on "${input.pendingField?.key ?? "nothing"}" and the reply answers it, include that key.
- selectedSlotId must be one of the offered option ids, or null.
${GUARDRAILS}`;
}

export function replyParserUserPrompt(input: ReplyParserInput): string {
  const slots = input.offeredSlots.map((s) => `- id ${s.id}: ${s.label}`).join("\n");
  return `${businessBlock(input.business)}

Our last question: ${input.pendingField ? `"${input.pendingField.question}" (field: ${input.pendingField.key})` : "(none)"}
Offered appointment options:
${slots || "(none)"}

<conversation>
${input.conversationExcerpt}
</conversation>

<customer_message>
${input.reply}
</customer_message>`;
}
