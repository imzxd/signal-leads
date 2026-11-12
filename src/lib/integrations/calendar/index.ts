import type { BusinessHours } from "@/types/domain";
import { DevCalendarProvider } from "./dev-provider";
import type { CalendarProvider } from "./types";

/**
 * Resolve the calendar provider for an organization. Today every organization uses the
 * development provider; a connected Google/Outlook/Calendly integration will be chosen
 * here once those adapters exist.
 */
export function getCalendarProvider(opts: { businessHours: BusinessHours; timeZone: string }): CalendarProvider {
  return new DevCalendarProvider(opts.businessHours, opts.timeZone);
}

export type { CalendarProvider, AvailabilitySlot } from "./types";
