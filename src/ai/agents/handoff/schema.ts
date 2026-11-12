import { z } from "zod";

export const handoffOutputSchema = z.object({
  handoffRequired: z.boolean(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  reason: z.string().describe("Short owner-facing reason, under 12 words"),
  ownerSummary: z.string().describe("2–3 sentences: who, what they need, why a human is needed, what to do next"),
  confidence: z.number(),
});

export type HandoffOutput = z.infer<typeof handoffOutputSchema>;
