import type { OfferedSlot } from "@/features/leads/lead-state";

const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
const CARDINALS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_ALIASES: Record<string, string> = { tues: "tue", weds: "wed", thur: "thu", thurs: "thu" };

/**
 * Match a customer's reply to one offered slot without AI.
 * Returns null when nothing (or more than one slot) matches — ambiguity goes to the Booking Agent.
 */
export function matchSlotDeterministic(reply: string, slots: OfferedSlot[]): OfferedSlot | null {
  const t = reply.toLowerCase().trim();
  if (!slots.length || !t) return null;

  const numeric =
    t.match(/^(?:option\s*|#|number\s*)?(\d)\b[.!]?$/) ??
    t.match(/\b(?:option|#|number|slot)\s*(\d)\b/) ??
    // "2 works for me", "3 please" — but not "2 story house", "2pm", "2:30" or "2 years".
    t.match(/^(\d)\b(?!\s*(?::|am\b|pm\b|\.\d|years?|yrs?|days?|weeks?|hours?|story|storey|stories|car|bed))/);
  if (numeric) return slots.find((s) => s.id === numeric[1]) ?? null;

  const bare = t.replace(/[.!]+$/, "");
  if (CARDINALS[bare]) return slots.find((s) => s.id === String(CARDINALS[bare])) ?? null;
  const ordinalHits = Object.entries(ORDINALS).filter(([word]) => new RegExp(`\\b${word}\\b`).test(t));
  if (ordinalHits.length === 1) {
    const slot = slots.find((s) => s.id === String(ordinalHits[0][1]));
    if (slot) return slot;
  }

  const words = t.replace(/[^a-z0-9:\s]/g, " ").split(/\s+/);
  const mentionedDays = new Set(
    words
      .map((w) => DAY_ALIASES[w] ?? w.slice(0, 3))
      .filter((w, i) => DAYS.includes(w) && /^(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)$/.test(words[i])),
  );
  const timeMatch = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);

  const candidates = slots.filter((s) => {
    const label = s.label.toLowerCase();
    const dayOk = mentionedDays.size === 0 || [...mentionedDays].some((d) => label.startsWith(d));
    let timeOk = true;
    if (timeMatch && /:|am|pm/.test(timeMatch[0])) {
      const hour = Number(timeMatch[1]);
      const minute = timeMatch[2] ?? "00";
      timeOk = new RegExp(`\\b${hour}:${minute}`).test(label) && (!timeMatch[3] || label.includes(timeMatch[3]));
    }
    return dayOk && timeOk && (mentionedDays.size > 0 || (timeMatch !== null && /:|am|pm/.test(timeMatch[0])));
  });
  return candidates.length === 1 ? candidates[0] : null;
}
