import { z } from "zod";

export const knowledgeOutputSchema = z.object({
  answerable: z.boolean().describe("True only if the provided knowledge explicitly answers the question"),
  answer: z.string().nullable().describe("Plain-language answer grounded only in the knowledge, or null"),
  sourceIds: z.array(z.string()).describe("IDs of the knowledge chunks the answer relies on"),
  confidence: z.number(),
});

export type KnowledgeOutput = z.infer<typeof knowledgeOutputSchema>;
