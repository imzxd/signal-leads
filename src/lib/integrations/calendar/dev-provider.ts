import { randomUUID } from "node:crypto";
import type { BusinessHours } from "@/types/domain";
import type { AvailabilityQuery, AvailabilitySlot, CalendarProvider, CreateEventInput } from "./types";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * DEVELOPMENT CALENDAR PROVIDER.
 * Generates availability from the organization's business hours in its timezone and
 * excludes appointments already stored in Signal Leads. Events are only recorded
 * locally — nothing is written to an external calendar.
 */
export class DevCalendarProvider implements CalendarProvider {
  readonly id = "dev-calendar";
  readonly label = "Development calendar (simulated)";
  readonly isDevelopment = true;

  constructor(private hours: BusinessHours, private timeZone: string, private stepMinutes = 90) {}

  async getAvailability(q: AvailabilityQuery): Promise<AvailabilitySlot[]> {
    const slots: AvailabilitySlot[] = [];
    const durationMs = q.durationMinutes * 60_000;
    for (let d = 0; d < q.days && slots.length < q.limit * 4; d++) {
      const dayStart = new Date(q.from.getTime() + d * 86_400_000);
      const local = zonedParts(dayStart, this.timeZone);
      const hours = this.hours[DAY_KEYS[local.weekday]];
      if (!hours) continue;
      const [oh, om] = hours.open.split(":").map(Number);
      const [ch, cm] = hours.close.split(":").map(Number);
      for (let minutes = oh * 60 + om; minutes + q.durationMinutes <= ch * 60 + cm; minutes += this.stepMinutes) {
        const start = zonedTimeToUtc(local.year, local.month, local.day, Math.floor(minutes / 60), minutes % 60, this.timeZone);
        if (start.getTime() <= q.from.getTime()) continue;
        const end = new Date(start.getTime() + durationMs);
        const overlaps = q.busy.some((b) => start < b.endsAt && end > b.startsAt);
        if (!overlaps) slots.push({ startsAt: start, endsAt: end });
      }
    }
    return spreadAcrossDays(slots, q.limit, this.timeZone);
  }

  async createEvent(_input: CreateEventInput) {
    return { externalId: `dev_${randomUUID()}` };
  }

  async cancelEvent() {}
}

/** Prefer offering options on different days, earliest first. */
function spreadAcrossDays(slots: AvailabilitySlot[], limit: number, tz: string): AvailabilitySlot[] {
  const picked: AvailabilitySlot[] = [];
  const usedDays = new Set<string>();
  for (const s of slots) {
    const p = zonedParts(s.startsAt, tz);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (usedDays.has(key)) continue;
    usedDays.add(key);
    picked.push(s);
    if (picked.length === limit) return picked;
  }
  for (const s of slots) {
    if (picked.length === limit) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")), minute: Number(get("minute")), weekday };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (DST-safe via offset correction). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = asIfUtc - guess;
  const corrected = new Date(guess - offset);
  const p2 = zonedParts(corrected, timeZone);
  const offset2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute) - corrected.getTime();
  return offset2 === offset ? corrected : new Date(guess - offset2);
}
