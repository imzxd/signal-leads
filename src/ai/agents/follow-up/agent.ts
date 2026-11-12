import { z } from "zod";
import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { ContactChannel, FollowUpStep } from "@/types/domain";
import { GUARDRAILS, clamp01, type BusinessProfile } from "../shared/context";
import { truncate } from "../shared/text-signals";

/**
 * Follow-Up Agent. Whether a follow-up may be sent at all is decided deterministically by
 * the follow-up engine (stop conditions, consent, idempotency). This agent only writes the
 * approved strategy's message, personalised to the lead.
 */
export const followUpOutputSchema = z.object({
  message: z.string(),
  confidence: z.number(),
});
export type FollowUpOutput = z.infer<typeof followUpOutputSchema>;

export interface FollowUpInput {
  business: BusinessProfile;
  channel: ContactChannel;
  strategy: FollowUpStep["strategy"];
  template: string | null;
  sequenceNumber: number;
  totalSteps: number;
  leadFirstName: string | null;
  serviceRequested: string | null;
  pendingQuestion: string | null;
  lastOutboundMessage: string | null;
}

const STRATEGY_BRIEF: Record<FollowUpStep["strategy"], string> = {
  gentle_check_in: "A short, friendly check-in. If there is a pending question, ask it again in different words.",
  value_reminder: "Remind them why it's worth acting (e.g. getting it looked at before it gets worse) without pressure or invented offers.",
  last_chance: "A polite final note: ask if they still want help, and say we'll close the request otherwise. No guilt-tripping.",
  custom: "Follow the business's template closely, personalising only names and the service.",
};

export function followUpHeuristic(i: FollowUpInput): FollowUpOutput {
  const name = i.leadFirstName ? `Hi ${i.leadFirstName}, ` : "Hi, ";
  const svc = i.serviceRequested ? `your ${i.serviceRequested.toLowerCase()} request` : "your request";
  let message: string;
  if (i.template) {
    message = i.template.replace(/\{first_name\}/g, i.leadFirstName ?? "there").replace(/\{service\}/g, i.serviceRequested ?? "your project").replace(/\{business\}/g, i.business.name);
  } else if (i.strategy === "gentle_check_in") {
    message = `${name}just following up on ${svc} with ${i.business.name}. ${i.pendingQuestion ? `When you have a moment: ${i.pendingQuestion}` : "Is this still something we can help with?"}`;
  } else if (i.strategy === "value_reminder") {
    message = `${name}${i.business.name} here. We'd still be glad to help with ${svc} — catching issues early usually keeps the fix simpler. Just reply and we'll take it from there.`;
  } else {
    message = `${name}I don't want to keep filling your inbox — should we close out ${svc}? If you'd still like help, just reply any time.`;
  }
  if (i.channel !== "sms") message += `\n\n— ${i.business.name}`;
  return { message, confidence: 0.7 };
}

export const followUpAgent: AgentDefinition<FollowUpInput, FollowUpOutput> = {
  type: "follow_up",
  schema: followUpOutputSchema,
  system: (i) => `You write follow-up message #${i.sequenceNumber} of ${i.totalSteps} for ${i.business.name} to a lead who hasn't replied.
Strategy: ${STRATEGY_BRIEF[i.strategy]}
${i.template ? `Business template: """${i.template}"""` : ""}
- ${i.channel === "sms" ? "SMS: under 280 characters, no sign-off." : "Email: 2–3 short sentences, sign off with the business name."}
- Never invent discounts, deadlines, availability or prices. Never pretend to be a person by name.
${GUARDRAILS}`,
  prompt: (i) => `Customer first name: ${i.leadFirstName ?? "unknown"}
Service: ${i.serviceRequested ?? "unknown"}
Pending question: ${i.pendingQuestion ?? "none"}
Our last message: ${i.lastOutboundMessage ? `"${truncate(i.lastOutboundMessage, 400)}"` : "none"}`,
  heuristic: followUpHeuristic,
  normalize: (o, i) => ({ message: truncate(o.message.trim(), i.channel === "sms" ? 480 : 1200), confidence: clamp01(o.confidence) }),
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ strategy: i.strategy, sequenceNumber: i.sequenceNumber, channel: i.channel }),
};
