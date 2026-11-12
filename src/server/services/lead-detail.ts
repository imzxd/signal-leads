import { desc, eq } from "drizzle-orm";
import { leadScores, profiles } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { findLead, getCustomFields } from "@/server/repositories/leads";
import { listMessages } from "@/server/repositories/conversations";
import { listEvents } from "@/server/repositories/events";
import { listFollowUps } from "@/server/jobs/follow-ups";
import { listLeadAppointments } from "@/server/repositories/appointments";
import { getSettings } from "@/server/repositories/settings";
import { listTeam } from "@/server/repositories/lead-list";
import type { TimelineItem } from "@/components/leads/activity-timeline";

export async function loadLeadDetail(ctx: OrgContext, leadId: string) {
  const lead = await findLead(ctx, leadId);
  if (!lead) return null;
  const [custom, msgs, events, [score], followUps, appointments, settings, team] = await Promise.all([
    getCustomFields(ctx, leadId),
    listMessages(ctx, leadId),
    listEvents(ctx, leadId),
    ctx.db.select().from(leadScores).where(eq(leadScores.leadId, leadId)).orderBy(desc(leadScores.createdAt)).limit(1),
    listFollowUps(ctx, leadId),
    listLeadAppointments(ctx, leadId),
    getSettings(ctx),
    listTeam(ctx),
  ]);
  const staffIds = [...new Set(msgs.map((m) => m.authorId).filter((x): x is string => Boolean(x)))];
  const staffNames = new Map<string, string>();
  for (const sid of staffIds) {
    const [p] = await ctx.db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, sid)).limit(1);
    if (p?.name) staffNames.set(sid, p.name);
  }

  const timeline: TimelineItem[] = [
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      at: e.createdAt.toISOString(),
      type: e.type,
      actor: e.actor,
      actorLabel: e.actorLabel,
      title: e.title,
      detail: e.detail,
      receipt: e.receipt,
    })),
    ...msgs.map((m) => ({
      kind: "message" as const,
      id: m.id,
      at: m.createdAt.toISOString(),
      direction: m.direction,
      authorType: m.authorType,
      authorLabel:
        m.direction === "inbound" ? (lead.name ?? "Customer") : m.authorType === "ai" ? "Signal" : m.authorType === "staff" ? (m.authorId ? (staffNames.get(m.authorId) ?? "Team") : "Team") : "System",
      channel: m.channel,
      body: m.body,
      status: m.status,
      blockReason: m.blockReason,
      purpose: typeof m.metadata?.purpose === "string" ? (m.metadata.purpose as string) : null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "event" ? -1 : 1));

  return {
    lead,
    custom,
    timeline,
    score: score ?? null,
    followUps,
    appointments,
    settings,
    team,
    assigneeName: team.find((t) => t.id === lead.assignedTo)?.name ?? null,
  };
}
