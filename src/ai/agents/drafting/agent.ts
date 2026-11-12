import { z } from "zod";
import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { OfferedSlot } from "@/features/leads/lead-state";
import type { ContactChannel, Urgency } from "@/types/domain";
import { GUARDRAILS, clamp01, type BusinessProfile } from "../shared/context";
import { truncate } from "../shared/text-signals";

export const DRAFT_PURPOSES = [
  "first_response",
  "reply",
  "booking_offer",
  "booking_confirmation",
  "handoff_holding",
  "out_of_scope",
  "closing",
  "staff_suggestion",
] as const;
export type DraftPurpose = (typeof DRAFT_PURPOSES)[number];

export const draftOutputSchema = z.object({
  message: z.string(),
  confidence: z.number(),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export interface DraftInput {
  business: BusinessProfile;
  purpose: DraftPurpose;
  channel: ContactChannel;
  leadFirstName: string | null;
  serviceRequested: string | null;
  location: string | null;
  urgency: Urgency;
  knowledgeAnswer: string | null;
  unansweredQuestion: string | null;
  nextQuestion: string | null;
  slots: OfferedSlot[];
  appointmentLabel: string | null;
  lastCustomerMessage: string | null;
  conversationExcerpt: string;
  /** Include opt-out language (first automated SMS). Appended by code, not the model. */
  includeOptOut: boolean;
}

const PURPOSE_BRIEF: Record<DraftPurpose, string> = {
  first_response: "First reply to a brand-new inquiry: thank them, acknowledge their specific need, answer any question using the provided answer, then ask the next question if one is given.",
  reply: "Reply in an ongoing conversation: acknowledge what they just told you, answer using the provided answer if any, then ask the next question if one is given.",
  booking_offer: "Tell them we can book a visit. Write ONLY a one or two sentence lead-in — the numbered list of times is appended automatically. Do not mention any dates or times.",
  booking_confirmation: "Warmly confirm the booking. The exact appointment time line is appended automatically — do not restate dates or times.",
  handoff_holding: "Let them know a team member will personally follow up shortly. Do not promise a specific time.",
  out_of_scope: "Politely explain we may not be able to help with this request (service or area), and that a team member will confirm.",
  closing: "Politely close the conversation and say they can reach out any time.",
  staff_suggestion: "Draft a helpful reply a staff member could send next, based on the conversation.",
};

function system(i: DraftInput): string {
  return `You write customer messages for ${i.business.name}${i.business.brandVoice ? `. Brand voice: ${i.business.brandVoice}` : ""}.
Goal: ${PURPOSE_BRIEF[i.purpose]}

Style:
- Sound like a helpful person at a local business, not a chatbot. No emojis, no exclamation-mark spam, no "As an AI".
- ${i.channel === "sms" ? "SMS: under 300 characters, no greeting line, no sign-off." : "Email/web: 2–4 short sentences, greet by first name if known, sign off with the business name."}
- Only state facts from the provided data. If an unanswered question is listed, say the team will confirm it — never guess.
- Ask at most one question.
${GUARDRAILS}`;
}

function prompt(i: DraftInput): string {
  return `Business phone: ${i.business.phone ?? "n/a"}
Customer first name: ${i.leadFirstName ?? "unknown"}
Service: ${i.serviceRequested ?? "unknown"} | Location: ${i.location ?? "unknown"} | Urgency: ${i.urgency}
Answer to their question (from knowledge base): ${i.knowledgeAnswer ?? "none"}
Question we could not answer: ${i.unansweredQuestion ?? "none"}
Next question to ask: ${i.nextQuestion ?? "none"}

<conversation>
${i.conversationExcerpt || "(none)"}
</conversation>`;
}

export function draftHeuristic(i: DraftInput): DraftOutput {
  const hi = i.channel === "sms" ? (i.leadFirstName ? `Hi ${i.leadFirstName}, ` : "Hi, ") : i.leadFirstName ? `Hi ${i.leadFirstName},\n\n` : "Hi there,\n\n";
  const svc = i.serviceRequested ? i.serviceRequested.toLowerCase() : "your request";
  const where = i.location ? ` in ${i.location}` : "";
  const urgencyLine =
    i.urgency === "emergency" ? " We know this can't wait and we're prioritizing it." : i.urgency === "urgent" ? " We'll move quickly on this." : "";
  const answer = i.knowledgeAnswer ? ` ${i.knowledgeAnswer}` : "";
  const unanswered = i.unansweredQuestion ? " Good question — I'll have the team confirm that detail for you." : "";
  const question = i.nextQuestion ? ` ${i.nextQuestion}` : "";
  let body: string;
  switch (i.purpose) {
    case "first_response":
      body = `${hi}thanks for reaching out to ${i.business.name} about ${svc}${where}.${urgencyLine}${answer}${unanswered}${question}`;
      break;
    case "reply":
      body = `${hi}thanks for the details.${answer}${unanswered}${question || " That's everything we need for now."}`;
      break;
    case "booking_offer":
      body = `${hi}thanks — we have what we need to book a visit for your ${svc}.${answer}`;
      break;
    case "booking_confirmation":
      body = `${hi}you're all set — we've booked your visit.`;
      break;
    case "handoff_holding":
      body = `${hi}thanks for your message. I've passed this to our team and someone will personally follow up with you shortly.`;
      break;
    case "out_of_scope":
      body = `${hi}thanks for thinking of ${i.business.name}. This request may be outside what we normally handle, so a team member will review it and confirm whether we can help.`;
      break;
    case "closing":
      body = `${hi}no problem at all — thanks for letting us know. If anything changes, just reply here and we'll be happy to help.`;
      break;
    case "staff_suggestion":
      body = `${hi}thanks for the update on ${svc}.${answer}${unanswered}${question || " Would you like us to book a time to take a look?"}`;
      break;
  }
  if (i.channel !== "sms") body += `\n\n— ${i.business.name}`;
  return { message: body.replace(/\s+\./g, ".").trim(), confidence: 0.7 };
}

/** Deterministic post-processing: availability, confirmations and compliance text come from code. */
export function finalizeDraft(o: DraftOutput, i: DraftInput): DraftOutput {
  let message = o.message
    .replace(/\[(?:name|first name|business|date|time)[^\]]*\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (i.purpose === "booking_offer" && i.slots.length) {
    const list = i.slots.map((s) => `${s.id}) ${s.label}`).join("\n");
    const instruction = `Reply with ${i.slots.map((s) => s.id).join(", ").replace(/, (\d)$/, " or $1")} to pick a time.`;
    message = insertBeforeSignOff(message, `\n\nNext available times:\n${list}\n\n${instruction}`, i);
  }
  if (i.purpose === "booking_confirmation" && i.appointmentLabel) {
    message = insertBeforeSignOff(message, `\n\nAppointment: ${i.appointmentLabel}`, i);
  }
  if (i.includeOptOut && i.channel === "sms" && !/reply stop/i.test(message)) message += " Reply STOP to opt out.";
  const max = i.channel === "sms" ? 640 : 1400;
  return { message: truncate(message, max), confidence: clamp01(o.confidence) };
}

function insertBeforeSignOff(message: string, block: string, i: DraftInput): string {
  const sign = `\n\n— ${i.business.name}`;
  return message.endsWith(sign) ? `${message.slice(0, -sign.length)}${block}${sign}` : `${message}${block}`;
}

export const draftingAgent: AgentDefinition<DraftInput, DraftOutput> = {
  type: "drafting",
  schema: draftOutputSchema,
  system,
  prompt,
  heuristic: draftHeuristic,
  normalize: finalizeDraft,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ purpose: i.purpose, channel: i.channel, nextQuestion: i.nextQuestion, slots: i.slots.length }),
};
