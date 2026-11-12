import { z } from "zod";
import { SENTIMENT_VALUES, URGENCY_VALUES } from "../shared/context";

export const REPLY_KINDS = ["answer", "question", "slot_selection", "reschedule", "not_interested", "human_request", "other"] as const;

export const replyParserOutputSchema = z.object({
  kind: z.enum(REPLY_KINDS),
  fields: z.array(z.object({ key: z.string(), value: z.string() })).describe("New values for known field keys that this reply provides"),
  questions: z.array(z.string()),
  selectedSlotId: z.string().nullable().describe("Id of the offered appointment option the customer chose, if any"),
  sentiment: z.enum(SENTIMENT_VALUES),
  urgency: z.enum(URGENCY_VALUES),
  confidence: z.number(),
});

export type ReplyParserOutput = z.infer<typeof replyParserOutputSchema>;
