import type { MessagingHours } from "@/types/domain";
import { zonedParts, zonedTimeToUtc } from "@/lib/integrations/calendar/dev-provider";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Returns null when sending is allowed now, otherwise the next allowed time. */
export function nextAllowedSendTime(now: Date, hours: MessagingHours, timeZone: string): Date | null {
  if (!hours.enabled) return null;
  const p = zonedParts(now, timeZone);
  const minutes = p.hour * 60 + p.minute;
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (minutes >= start && minutes < end) return null;
  const sh = Math.floor(start / 60);
  const sm = start % 60;
  if (minutes < start) return zonedTimeToUtc(p.year, p.month, p.day, sh, sm, timeZone);
  const tomorrow = zonedParts(new Date(now.getTime() + 24 * 3600_000), timeZone);
  return zonedTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, sh, sm, timeZone);
}
