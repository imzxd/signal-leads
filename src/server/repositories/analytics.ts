import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { agentEvents, appointments, followUps, leads, messages } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { queryRows } from "@/server/db/client";
import { SOURCE_LABELS, STAGE_LABELS, type LeadSource, type LeadStage } from "@/types/domain";
import { zonedParts } from "@/lib/integrations/calendar/dev-provider";

const DAY = 86_400_000;
const OPEN_STAGES: LeadStage[] = ["new", "contacted", "qualifying", "qualified", "hot", "booking", "booked", "needs_human"];
const QUALIFIED_STAGES: LeadStage[] = ["qualified", "hot", "booking", "booked", "won"];

export interface Metrics {
  rangeDays: number;
  leadsReceived: number;
  newLeads7d: number;
  leadsContacted: number;
  qualifiedLeads: number;
  qualificationRate: number | null;
  hotLeads: number;
  bookings: number;
  wins: number;
  losses: number;
  conversionRate: number | null;
  estimatedPipeline: number;
  wonRevenue: number;
  avgFirstResponseMs: number | null;
  aiHandledPct: number | null;
  handoffPct: number | null;
  followUpsSent: number;
  recoveredLeads: number;
  recoveredPipeline: number;
  aiActions: number;
  humanInterventions: number;
  aiCostUsd: number;
  aiFallbacks: number;
  leadsByDay: { date: string; label: string; leads: number }[];
  bySource: { source: string; leads: number }[];
  funnel: { stage: string; count: number }[];
  scoreBuckets: { bucket: string; count: number; tier: number }[];
  appointmentsByWeek: { week: string; count: number }[];
  pipelineByStage: { stage: string; value: number; count: number }[];
  agentUsage: { agent: string; runs: number; fallbacks: number; avgLatencyMs: number; costUsd: number }[];
}

export async function getMetrics(ctx: OrgContext, rangeDays = 30, timeZone = "America/Toronto"): Promise<Metrics> {
  const now = Date.now();
  const since = new Date(now - rangeDays * DAY);
  const org = eq(leads.organizationId, ctx.organizationId);

  const rows = await ctx.db
    .select({
      id: leads.id,
      stage: leads.stage,
      source: leads.source,
      score: leads.score,
      temperature: leads.temperature,
      estimatedValue: leads.estimatedValue,
      wonValue: leads.wonValue,
      createdAt: leads.createdAt,
      firstResponseAt: leads.firstResponseAt,
      recoveredAt: leads.recoveredAt,
      wonAt: leads.wonAt,
      lostAt: leads.lostAt,
      isSpam: leads.isSpam,
      qualificationComplete: leads.qualificationComplete,
    })
    .from(leads)
    .where(org);

  const real = rows.filter((l) => !l.isSpam);
  const inRange = real.filter((l) => l.createdAt >= since);
  const contacted = inRange.filter((l) => l.firstResponseAt);
  const qualified = inRange.filter((l) => l.qualificationComplete || QUALIFIED_STAGES.includes(l.stage));
  const wins = real.filter((l) => l.wonAt && l.wonAt >= since);
  const losses = real.filter((l) => l.lostAt && l.lostAt >= since);
  const open = real.filter((l) => OPEN_STAGES.includes(l.stage));
  const recovered = real.filter((l) => l.recoveredAt && l.recoveredAt >= since);
  const responseTimes = contacted.map((l) => l.firstResponseAt!.getTime() - l.createdAt.getTime()).filter((ms) => ms >= 0);
  const closed = wins.length + losses.length;

  const leadIds = inRange.map((l) => l.id);
  const [handoffLeads, staffTouched, fuSent, runs, interventions, bookingsCount, apptRows] = await Promise.all([
    leadIds.length
      ? ctx.db.selectDistinct({ leadId: agentEvents.leadId }).from(agentEvents).where(and(eq(agentEvents.organizationId, ctx.organizationId), eq(agentEvents.type, "handoff_requested"), inArray(agentEvents.leadId, leadIds)))
      : Promise.resolve([]),
    leadIds.length
      ? ctx.db.selectDistinct({ leadId: messages.leadId }).from(messages).where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.authorType, "staff"), eq(messages.direction, "outbound"), inArray(messages.leadId, leadIds)))
      : Promise.resolve([]),
    ctx.db.select({ n: count() }).from(followUps).where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.status, "sent"), gte(followUps.executedAt, since))),
    queryRows<{ agent: string; runs: number; fallbacks: number; avg_latency: number; cost: number }>(
      ctx.db,
      sql`select agent, count(*)::int as runs, count(*) filter (where status = 'fallback')::int as fallbacks,
                 coalesce(avg(latency_ms), 0)::int as avg_latency, coalesce(sum(estimated_cost_usd), 0)::float as cost
          from agent_runs where organization_id = ${ctx.organizationId} and created_at >= ${since.toISOString()}
          group by agent order by runs desc`,
    ),
    ctx.db
      .select({ n: count() })
      .from(agentEvents)
      .where(and(eq(agentEvents.organizationId, ctx.organizationId), eq(agentEvents.actor, "staff"), gte(agentEvents.createdAt, since))),
    ctx.db.select({ n: count() }).from(appointments).where(and(eq(appointments.organizationId, ctx.organizationId), gte(appointments.createdAt, since), inArray(appointments.status, ["confirmed", "completed"]))),
    ctx.db.select({ createdAt: appointments.createdAt }).from(appointments).where(and(eq(appointments.organizationId, ctx.organizationId), gte(appointments.createdAt, new Date(now - 8 * 7 * DAY)), inArray(appointments.status, ["confirmed", "completed"]))),
  ]);

  const dayKey = (d: Date) => {
    const p = zonedParts(d, timeZone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  };
  const byDay = new Map<string, number>();
  for (let i = rangeDays - 1; i >= 0; i--) byDay.set(dayKey(new Date(now - i * DAY)), 0);
  inRange.forEach((l) => {
    const k = dayKey(l.createdAt);
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  });

  const sourceCounts = new Map<string, number>();
  inRange.forEach((l) => sourceCounts.set(l.source, (sourceCounts.get(l.source) ?? 0) + 1));

  const funnel = [
    { stage: "Received", count: inRange.length },
    { stage: "Contacted", count: contacted.length },
    { stage: "Qualified", count: qualified.length },
    { stage: "Booked", count: inRange.filter((l) => ["booked", "won"].includes(l.stage)).length },
    { stage: "Won", count: inRange.filter((l) => l.stage === "won").length },
  ];

  const buckets = [
    { bucket: "Cold 0–29", min: 0, max: 29, tier: 1 },
    { bucket: "Warm 30–59", min: 30, max: 59, tier: 2 },
    { bucket: "Qualified 60–79", min: 60, max: 79, tier: 3 },
    { bucket: "Hot 80–100", min: 80, max: 100, tier: 4 },
  ].map((b) => ({ bucket: b.bucket, tier: b.tier, count: open.filter((l) => l.score >= b.min && l.score <= b.max).length }));

  const weeks: { week: string; count: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = now - (w + 1) * 7 * DAY;
    const end = now - w * 7 * DAY;
    const label = new Date(start + DAY).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone });
    weeks.push({ week: label, count: apptRows.filter((a) => a.createdAt.getTime() >= start && a.createdAt.getTime() < end).length });
  }

  const pipelineStages: LeadStage[] = ["new", "qualifying", "qualified", "hot", "booking", "booked"];
  const pipelineByStage = pipelineStages.map((stage) => {
    const ls = open.filter((l) => (stage === "new" ? ["new", "contacted"].includes(l.stage) : stage === "qualifying" ? ["qualifying", "needs_human"].includes(l.stage) : l.stage === stage));
    return { stage: STAGE_LABELS[stage], count: ls.length, value: ls.reduce((s, l) => s + (l.estimatedValue ?? 0), 0) };
  });

  const handoffSet = new Set(handoffLeads.map((h) => h.leadId));
  const staffSet = new Set(staffTouched.map((s) => s.leadId));
  const aiHandled = contacted.filter((l) => !handoffSet.has(l.id) && !staffSet.has(l.id)).length;

  return {
    rangeDays,
    leadsReceived: inRange.length,
    newLeads7d: real.filter((l) => l.createdAt.getTime() >= now - 7 * DAY).length,
    leadsContacted: contacted.length,
    qualifiedLeads: qualified.length,
    qualificationRate: inRange.length ? qualified.length / inRange.length : null,
    hotLeads: open.filter((l) => l.temperature === "hot").length,
    bookings: bookingsCount[0]?.n ?? 0,
    wins: wins.length,
    losses: losses.length,
    conversionRate: closed ? wins.length / closed : null,
    estimatedPipeline: open.reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
    wonRevenue: wins.reduce((s, l) => s + (l.wonValue ?? l.estimatedValue ?? 0), 0),
    avgFirstResponseMs: responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null,
    aiHandledPct: contacted.length ? aiHandled / contacted.length : null,
    handoffPct: inRange.length ? handoffSet.size / inRange.length : null,
    followUpsSent: fuSent[0]?.n ?? 0,
    recoveredLeads: recovered.length,
    recoveredPipeline: recovered.reduce((s, l) => s + (l.wonValue ?? l.estimatedValue ?? 0), 0),
    aiActions: runs.reduce((s, r) => s + Number(r.runs), 0),
    humanInterventions: interventions[0]?.n ?? 0,
    aiCostUsd: runs.reduce((s, r) => s + Number(r.cost), 0),
    aiFallbacks: runs.reduce((s, r) => s + Number(r.fallbacks), 0),
    leadsByDay: [...byDay.entries()].map(([date, n]) => ({
      date,
      label: new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
      leads: n,
    })),
    bySource: [...sourceCounts.entries()].map(([source, n]) => ({ source: SOURCE_LABELS[source as LeadSource] ?? source, leads: n })).sort((a, b) => b.leads - a.leads),
    funnel,
    scoreBuckets: buckets,
    appointmentsByWeek: weeks,
    pipelineByStage,
    agentUsage: runs.map((r) => ({ agent: r.agent, runs: Number(r.runs), fallbacks: Number(r.fallbacks), avgLatencyMs: Number(r.avg_latency), costUsd: Number(r.cost) })),
  };
}
