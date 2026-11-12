import { z } from "zod";
import { SENTIMENT_VALUES, URGENCY_VALUES } from "../shared/context";

export const intakeOutputSchema = z.object({
  intent: z.string().describe("Short snake_case label, e.g. roof_repair, quote_request, general_question, spam"),
  serviceRequested: z.string().nullable().describe("The service in the customer's words, e.g. 'roof leak repair'"),
  serviceKey: z.string().nullable().describe("Key of the matching offered service, or null if none match"),
  urgency: z.enum(URGENCY_VALUES),
  location: z.string().nullable().describe("City or area"),
  address: z.string().nullable().describe("Street address if given"),
  timeline: z.string().nullable(),
  budget: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  summary: z.string().describe("One or two sentences an owner can scan in five seconds"),
  questions: z.array(z.string()).describe("Questions the customer asked that need business knowledge to answer"),
  fields: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .describe("Values for the business's qualification fields that the message explicitly provides"),
  sentiment: z.enum(SENTIMENT_VALUES),
  asksForHuman: z.boolean(),
  isExistingCustomer: z.boolean(),
  missingFields: z.array(z.string()),
  confidence: z.number().describe("0 to 1 — how confident you are in this extraction"),
});

export type IntakeOutput = z.infer<typeof intakeOutputSchema>;
