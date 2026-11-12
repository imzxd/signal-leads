/**
 * Calendar provider abstraction. The Booking Agent can only offer times returned by
 * `getAvailability` and only books through `createEvent`.
 *
 * Implementations: DevCalendarProvider (built-in). Planned: Google Calendar, Microsoft
 * Outlook (Graph), Calendly — each implements this interface and is selected per
 * organization via integration_connections.
 */
export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
}

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilityQuery {
  from: Date;
  days: number;
  durationMinutes: number;
  limit: number;
  /** Existing confirmed appointments (from our DB) to exclude. */
  busy: BusyInterval[];
}

export interface CreateEventInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  notes?: string | null;
  attendeeEmail?: string | null;
}

export interface CalendarProvider {
  readonly id: string;
  readonly label: string;
  readonly isDevelopment: boolean;
  getAvailability(query: AvailabilityQuery): Promise<AvailabilitySlot[]>;
  createEvent(input: CreateEventInput): Promise<{ externalId: string }>;
  cancelEvent(externalId: string): Promise<void>;
}
