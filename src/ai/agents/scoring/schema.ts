import { z } from "zod";

/** The ONLY things the model contributes to a score. Weights and math live in code. */
export const scoringSignalsSchema = z.object({
  buyingIntent: z.enum(["high", "medium", "low", "none"]),
  isSpam: z.boolean().describe("Spam, sales pitch, gibberish or obviously fake inquiry"),
  isPriceShopper: z.boolean().describe("Mainly collecting prices with no intent to book"),
  confidence: z.number(),
});

export type ScoringSignals = z.infer<typeof scoringSignalsSchema>;
