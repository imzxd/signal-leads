import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { OfferedSlot } from "@/features/leads/lead-state";
import type { QualificationField } from "@/types/domain";
import { matchSlotDeterministic } from "../booking/slot-matcher";
import { clamp01, type BusinessProfile } from "../shared/context";
import { answerForPendingField, extractKnownField } from "../shared/field-extractors";
import {
  asksForHuman,
  detectNotInterested,
  detectSentiment,
  detectUrgency,
  extractAddress,
  extractEmail,
  extractName,
  extractPhone,
  extractQuestions,
  findAnyPlace,
} from "../shared/text-signals";
import { replyParserSystemPrompt, replyParserUserPrompt } from "./prompt";
import { replyParserOutputSchema, type ReplyParserOutput } from "./schema";

export interface ReplyParserInput {
  business: BusinessProfile;
  reply: string;
  pendingField: QualificationField | null;
  allowedFieldKeys: string[];
  offeredSlots: OfferedSlot[];
  conversationExcerpt: string;
}

export function replyParserHeuristic(input: ReplyParserInput): ReplyParserOutput {
  const { reply } = input;
  const fields: { key: string; value: string }[] = [];
  const put = (key: string, value: string | null) => {
    if (value && input.allowedFieldKeys.includes(key) && !fields.some((f) => f.key === key)) fields.push({ key, value });
  };

  const slot = input.offeredSlots.length ? matchSlotDeterministic(reply, input.offeredSlots) : null;
  const questions = extractQuestions(reply);

  if (input.pendingField && !slot) put(input.pendingField.key, answerForPendingField(input.pendingField.key, reply));
  for (const key of input.allowedFieldKeys) put(key, extractKnownField(key, reply));
  put("email", extractEmail(reply));
  put("phone", extractPhone(reply));
  put("name", extractName(reply));
  put("address", extractAddress(reply));
  put("location", findAnyPlace(reply, input.business.serviceArea.cities));

  let kind: ReplyParserOutput["kind"] = "other";
  if (asksForHuman(reply)) kind = "human_request";
  else if (detectNotInterested(reply)) kind = "not_interested";
  else if (slot) kind = "slot_selection";
  else if (input.offeredSlots.length && /\b(none of (those|these)|different (time|day)|other times?|doesn'?t work|can'?t make)\b/i.test(reply)) kind = "reschedule";
  else if (fields.length) kind = "answer";
  else if (questions.length) kind = "question";

  return {
    kind,
    fields,
    questions,
    selectedSlotId: slot?.id ?? null,
    sentiment: detectSentiment(reply),
    urgency: detectUrgency(reply),
    confidence: kind === "other" ? 0.45 : 0.75,
  };
}

export function normalizeReply(o: ReplyParserOutput, input: ReplyParserInput): ReplyParserOutput {
  const allowed = new Set(input.allowedFieldKeys);
  const slotIds = new Set(input.offeredSlots.map((s) => s.id));
  const deterministicSlot = input.offeredSlots.length ? matchSlotDeterministic(input.reply, input.offeredSlots) : null;
  const selectedSlotId = deterministicSlot?.id ?? (o.selectedSlotId && slotIds.has(o.selectedSlotId) ? o.selectedSlotId : null);
  return {
    ...o,
    kind: asksForHuman(input.reply) ? "human_request" : selectedSlotId && o.kind !== "reschedule" ? "slot_selection" : o.kind,
    fields: o.fields.filter((f) => allowed.has(f.key) && f.value.trim()).map((f) => ({ key: f.key, value: f.value.trim().slice(0, 200) })),
    selectedSlotId,
    questions: o.questions.slice(0, 3),
    confidence: clamp01(o.confidence),
  };
}

export const replyParserAgent: AgentDefinition<ReplyParserInput, ReplyParserOutput> = {
  type: "reply_parser",
  schema: replyParserOutputSchema,
  system: replyParserSystemPrompt,
  prompt: replyParserUserPrompt,
  heuristic: replyParserHeuristic,
  normalize: normalizeReply,
  confidence: (o) => o.confidence,
  describeInput: (i) => ({ reply: i.reply, pendingField: i.pendingField?.key ?? null, offeredSlots: i.offeredSlots.length }),
};
