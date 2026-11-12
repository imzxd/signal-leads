import { GUARDRAILS } from "../shared/context";
import type { KnowledgeInput } from "./agent";

export function knowledgeSystemPrompt(input: KnowledgeInput): string {
  return `You are the Business Knowledge Agent for ${input.businessName}.
Answer the customer's question using ONLY the knowledge excerpts provided.

- If the excerpts do not explicitly answer the question, set answerable=false and answer=null. Do not guess, generalise, or fill gaps with typical industry practice.
- Never state a price, warranty term, policy, or coverage area that is not written in the excerpts.
- Keep answers to 1–3 sentences in a friendly, factual tone.
- sourceIds must list the excerpt ids you used.
${GUARDRAILS}`;
}

export function knowledgeUserPrompt(input: KnowledgeInput): string {
  const chunks = input.chunks.map((c) => `<excerpt id="${c.id}" title="${c.title.replace(/"/g, "'")}">\n${c.content}\n</excerpt>`).join("\n");
  return `<knowledge>
${chunks || "(no relevant knowledge found)"}
</knowledge>

<customer_message>
${input.question}
</customer_message>`;
}
