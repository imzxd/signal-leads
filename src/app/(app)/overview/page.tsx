import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight, CalendarCheck, LifeBuoy } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { agentEvents, leads } from "@/server/db/schema";
import { getMetrics } from "@/server/repositories/analytics";
import { upcomingAppointments } from "@/server/repositories/appointments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { BarList, ColumnChart, Funnel, SEQ_RAMP, TrendChart } from "@/components/analytics/charts";
import { ScoreMeter, TemperatureBadge } from "@/components/leads/lead-badges";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { formatCurrency, formatDateTime, formatDuration, formatPercent } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage() {
  const { session, ctx } = await requireOrgContext();
  const tz = session.organization.timezone;
  const [m, feed, attention, upcoming] = await Promise.all([
    getMetrics(ctx, 30, tz),
    ctx.db
      .select({ e: agentEvents, leadName: leads.name })
      .from(agentEvents)
      .innerJoin(leads, eq(leads.id, agentEvents.leadId))
      .where(eq(agentEvents.organizationId, ctx.organizationId))
      .orderBy(desc(agentEvents.createdAt))
      .limit(14),
    ctx.db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.organizationId), inArray(leads.stage, ["needs_human", "hot", "booking"])))
      .orderBy(desc(leads.score))
      .limit(6),
    upcomingAppointments(ctx, 5),
  ]);
  const leadNames = new Map((await ctx.db.select({ id: leads.id, name: leads.name }).from(leads).where(eq(leads.organizationId, ctx.organizationId))).map((l) => [l.id, l.name]));

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={8000} />
      <PageHeader eyebrow="Overview" title={`${greeting(tz)}, ${session.name.split(" ")[0]}`} description="Here's what Signal handled for you over the last 30 days." />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="New leads" value={m.newLeads7d} sub="Last 7 days" />
        <StatCard label="Hot leads" value={m.hotLeads} sub="Open, score 80+" />
        <StatCard label="Qualified leads" value={m.qualifiedLeads} sub={`${formatPercent(m.qualificationRate)} of leads received`} />
        <StatCard label="Appointments booked" value={m.bookings} sub="Last 30 days" />
        <StatCard label="Conversion rate" value={formatPercent(m.conversionRate)} sub={`${m.wins} won · ${m.losses} lost`} hint="Won ÷ (won + lost) for leads closed in the period." />
        <StatCard label="Estimated pipeline" value={formatCurrency(m.estimatedPipeline, { compact: true })} sub="Open leads × typical job value" />
        <StatCard
          label="Recovered leads"
          value={m.recoveredLeads}
          sub={`${formatCurrency(m.recoveredPipeline, { compact: true })} re-engaged by follow-ups`}
          hint="Leads that went quiet, then replied after an automated Signal follow-up."
          highlight
        />
        <StatCard label="Avg. response time" value={formatDuration(m.avgFirstResponseMs)} sub="Lead received → first reply" />
        <StatCard label="AI actions completed" value={m.aiActions} sub={`${m.aiFallbacks} used a fallback`} />
        <StatCard label="Human interventions" value={m.humanInterventions} sub={`${formatPercent(m.aiHandledPct)} handled fully by Signal`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Leads by day</CardTitle>
              <CardDescription>{m.leadsReceived} leads received in the last 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <TrendChart data={m.leadsByDay} xKey="label" yKey="leads" caption="Leads received per day" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Needs your attention</CardTitle>
              <CardDescription>Handoffs, hot leads and open booking offers</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-2">
            {attention.length === 0 ? (
              <EmptyState icon={<LifeBuoy />} title="Nothing needs you right now" description="Signal will flag leads that need a human." />
            ) : (
              attention.map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-surface-hover/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{l.name ?? "Unnamed lead"}</span>
                    <span className="block truncate text-[11px] text-foreground-subtle">{l.stage === "needs_human" ? (l.handoff?.reason ?? "Needs a human") : l.nextAction}</span>
                  </span>
                  {l.stage === "needs_human" ? <LifeBuoy className="size-4 text-temp-hot" aria-label="Needs human" /> : <TemperatureBadge temperature={l.temperature} />}
                  <ScoreMeter score={l.score} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:row-span-2">
          <CardHeader>
            <div>
              <CardTitle>Live activity</CardTitle>
              <CardDescription>Every automated decision, as it happens</CardDescription>
            </div>
            <Link href="/leads" className="text-xs text-accent hover:underline">
              All leads
            </Link>
          </CardHeader>
          <ActivityFeed items={feed.map(({ e, leadName }) => ({ id: e.id, leadId: e.leadId, leadName, type: e.type, actor: e.actor, actorLabel: e.actorLabel, title: e.title, createdAt: e.createdAt }))} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead stage funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <Funnel steps={m.funnel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lead source</CardTitle>
          </CardHeader>
          <CardContent>
            {m.bySource.length ? <BarList items={m.bySource.map((s) => ({ label: s.source, value: s.leads }))} /> : <p className="text-xs text-foreground-muted">No leads yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Score distribution</CardTitle>
              <CardDescription>Open leads by temperature</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ColumnChart data={m.scoreBuckets.map((b) => ({ bucket: b.bucket.split(" ")[0], count: b.count }))} xKey="bucket" yKey="count" colors={SEQ_RAMP} caption="Open leads by score tier" height={170} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Upcoming appointments</CardTitle>
              <CardDescription>Booked by Signal and your team</CardDescription>
            </div>
            <CalendarCheck className="size-4 text-foreground-subtle" aria-hidden />
          </CardHeader>
          <CardContent className="space-y-1 px-2">
            {upcoming.length === 0 ? (
              <p className="px-3 text-xs text-foreground-muted">No upcoming appointments.</p>
            ) : (
              upcoming.map((a) => (
                <Link key={a.id} href={`/leads/${a.leadId}`} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-surface-hover/60">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{leadNames.get(a.leadId) ?? "Lead"}</span>
                    <span className="block truncate text-[11px] text-foreground-subtle">{a.location ?? "Location to confirm"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-accent tabular">{formatDateTime(a.startsAt, tz)}</span>
                </Link>
              ))
            )}
            <Link href="/analytics" className="mt-2 flex items-center gap-1 px-3 text-xs text-foreground-muted hover:text-foreground">
              Full analytics <ArrowRight className="size-3" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
