import { z } from "zod";
import type { AgentDefinition } from "@/ai/runtime/run-agent";
import type { OfferedSlot } from "@/features/leads/lead-state";
import { GUARDRAILS, clamp01 } from "../shared/context";
import { matchSlotDeterministic } from "./slot-matcher";

/**
 * Booking Agent. Availability ALWAYS comes from the CalendarProvider tool — the agent
 * only interprets which offered option the customer meant. It cannot invent a time:
 * its output is constrained to the ids of slots we actually offered.
 */
export const bookingSelectionSchema = z.object({
  selectedSlotId: z.string().nullable(),
  wantsDifferentTimes: z.boolean(),
  confidence: z.number(),
});
export type BookingSelection = z.infer<typeof bookingSelectionSchema>;

export interface BookingSelectionInput {
  businessName: string;
  reply: string;
  offeredSlots: OfferedSlot[];
}

export function bookingHeuristic(input: BookingSelectionInput): BookingSelection {
  const slot = matchSlotDeterministic(input.reply, input.offeredSlots);
  const different = /\b(none of (those|these)|different (time|day)|other times?|doesn'?t work|can'?t make|another day)\b/i.test(input.reply);
  return { selectedSlotId: slot?.id ?? null, wantsDifferentTimes: !slot && different, confidence: slot ? 0.9 : 0.5 };
}

export const bookingAgent: AgentDefinition<BookingSelectionInput, BookingSelection> = {
  type: "booking",
  schema: bookingSelectionSchema,
  system: (i) => `You are the Booking Agent for ${i.businessName}. The customer was offered numbered appointment options.
Identify which option they chose. If they did not clearly choose exactly one option, return selectedSlotId=null.
Set wantsDifferentTimes=true if none of the options work for them.
${GUARDRAILS}`,
  prompt: (i) => `Offered options:
${i.offeredSlots.map((s) => `- id ${s.id}: ${s.label}`).join("\n")}

<customer_message>
${i.reply}
</customer_message>`,
  heuristic: bookingHeuristic,
  normalize: (o, i) => {
    const valid = i.offeredSlots.some((s) => s.id === o.selectedSlotId);
    return { selectedSlotId: valid ? o.selectedSlotId : null, wantsDifferentTimes: o.wantsDifferentTimes, confidence: clamp01(o.confidence) };
  },
  confidence: (o) => o.confidence,
};

export function formatSlotLabel(start: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(start);
  return `${day} · ${time}`;
}
