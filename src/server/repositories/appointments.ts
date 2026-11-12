import { and, asc, eq, gte, lt, gt } from "drizzle-orm";
import { appointments, type Appointment, type Lead } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { getCalendarProvider } from "@/lib/integrations/calendar";
import { formatSlotLabel } from "@/ai/agents/booking/agent";
import type { OfferedSlot } from "@/features/leads/lead-state";
import type { ResolvedSettings } from "./settings";

export class SlotUnavailableError extends Error {
  constructor() {
    super("That time is no longer available");
    this.name = "SlotUnavailableError";
  }
}

export async function getAvailableSlots(ctx: OrgContext, settings: ResolvedSettings, opts: { now?: Date; limit?: number } = {}): Promise<OfferedSlot[]> {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() + settings.booking.minLeadTimeHours * 3600_000);
  const horizon = new Date(from.getTime() + 14 * 86_400_000);
  const busy = await ctx.db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.status, "confirmed"), gte(appointments.endsAt, from), lt(appointments.startsAt, horizon)));
  const provider = getCalendarProvider({ businessHours: settings.businessHours, timeZone: settings.organization.timezone });
  const slots = await provider.getAvailability({
    from,
    days: 14,
    durationMinutes: settings.booking.durationMinutes,
    limit: opts.limit ?? settings.booking.slotsToOffer,
    busy,
  });
  return slots.map((s, i) => ({
    id: String(i + 1),
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    label: formatSlotLabel(s.startsAt, settings.organization.timezone),
  }));
}

/** Books a slot after re-checking for conflicts — availability is never assumed. */
export async function createAppointment(
  ctx: OrgContext,
  settings: ResolvedSettings,
  lead: Lead,
  slot: { startsAt: string; endsAt: string },
  createdBy: "agent" | "staff",
  notes?: string | null,
): Promise<Appointment> {
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  if (!(endsAt > startsAt)) throw new SlotUnavailableError();
  const provider = getCalendarProvider({ businessHours: settings.businessHours, timeZone: settings.organization.timezone });
  return ctx.db.transaction(async (tx) => {
    const conflicts = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.status, "confirmed"), lt(appointments.startsAt, endsAt), gt(appointments.endsAt, startsAt)))
      .limit(1);
    if (conflicts.length) throw new SlotUnavailableError();
    const title = `${settings.booking.appointmentLabel} — ${lead.name ?? "New lead"}`;
    const { externalId } = await provider.createEvent({ title, startsAt, endsAt, location: lead.address ?? lead.location, attendeeEmail: lead.email, notes });
    const [row] = await tx
      .insert(appointments)
      .values({
        organizationId: ctx.organizationId,
        leadId: lead.id,
        title,
        startsAt,
        endsAt,
        status: "confirmed",
        provider: provider.id,
        externalId,
        location: lead.address ?? lead.location,
        notes: notes ?? null,
        createdBy,
      })
      .returning();
    return row;
  });
}

export async function listLeadAppointments(ctx: OrgContext, leadId: string): Promise<Appointment[]> {
  return ctx.db
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.leadId, leadId)))
    .orderBy(asc(appointments.startsAt));
}

export async function upcomingAppointments(ctx: OrgContext, limit = 8) {
  return ctx.db
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.status, "confirmed"), gte(appointments.startsAt, new Date())))
    .orderBy(asc(appointments.startsAt))
    .limit(limit);
}
