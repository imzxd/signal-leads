import { z } from "zod";

export const QUALIFICATION_REASON_CODES = ["missing_required", "missing_optional", "complete", "clarify"] as const;

export const qualificationOutputSchema = z.object({
  qualificationComplete: z.boolean(),
  missingFields: z.array(z.string()),
  targetField: z.string().nullable().describe("The single field the next question asks about"),
  nextQuestion: z.string().nullable().describe("One short, friendly question, or null when complete"),
  reasonCode: z.enum(QUALIFICATION_REASON_CODES),
  confidence: z.number(),
});

export type QualificationOutput = z.infer<typeof qualificationOutputSchema>;
