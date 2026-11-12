import type { Metadata } from "next";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { getMetrics } from "@/server/repositories/analytics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/dashboard/stat-card";
import { BarList, ColumnChart, Funnel, SEQ_RAMP, TrendChart } from "@/components/analytics/charts";
import { AGENT_LABELS, type AgentType } from "@/types/domain";
import { cn, formatCurrency, formatDuration, formatPercent } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

const RANGES = [7, 30, 90] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const days = RANGES.find((r) => String(r) === range) ?? 30;
  const { session, ctx } = await requireOrgContext();
  const m = await getMetrics(ctx, days, session.organization.timezone);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="Return on Signal"
        description="What automation recovered, booked and won for the business."
        actions={
          <nav aria-label="Date range" className="inline-flex rounded-lg border border-border bg-background-raised p-0.5 text-xs">
            {RANGES.map((r) => (
              <Link key={r} href={`/analytics?range=${r}`} aria-current={r === days ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-foreground-muted hover:text-foreground", r === days && "bg-surface-elevated text-foreground")}>
                Last {r} days
              </Link>
            ))}
          </nav>
        }
      />

      <Card className="relative overflow-hidden border-accent/35 p-6">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <p className="eyebrow flex items-center gap-1.5">
              <RotateCcw className="size-3" /> Recovered leads
            </p>
            <p className="mt-2 font-display text-6xl leading-none tabular">{m.recoveredLeads}</p>
            <p className="mt-2 max-w-xs text-xs text-foreground-muted">Leads that went quiet and came back after an automated Signal follow-up — work you would likely have lost.</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Recovered pipeline</p>
            <p className="mt-2 font-display text-4xl tabular">{formatCurrency(m.recoveredPipeline)}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Won revenue</p>
            <p className="mt-2 font-display text-4xl tabular">{formatCurrency(m.wonRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Avg. first response</p>
            <p className="mt-2 font-display text-4xl tabular">{formatDuration(m.avgFirstResponseMs)}</p>
          </div>
        </div>
      </Card>

      <section aria-label="Metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Leads received" value={m.leadsReceived} />
        <StatCard label="Leads contacted" value={m.leadsContacted} />
        <StatCard label="Qualification rate" value={formatPercent(m.qualificationRate)} />
        <StatCard label="Qualified leads" value={m.qualifiedLeads} />
        <StatCard label="Hot leads" value={m.hotLeads} sub="Open now" />
        <StatCard label="Bookings" value={m.bookings} />
        <StatCard label="Wins" value={m.wins} />
        <StatCard label="Losses" value={m.losses} />
        <StatCard label="Conversion rate" value={formatPercent(m.conversionRate)} hint="Won ÷ (won + lost)" />
        <StatCard label="Estimated pipeline" value={formatCurrency(m.estimatedPipeline, { compact: true })} />
        <StatCard label="AI-handled" value={formatPercent(m.aiHandledPct)} hint="Contacted leads that never needed a staff message or handoff." />
        <StatCard label="Human handoff" value={formatPercent(m.handoffPct)} />
        <StatCard label="Follow-ups sent" value={m.followUpsSent} />
        <StatCard label="AI actions" value={m.aiActions} />
        <StatCard label="AI cost" value={`$${m.aiCostUsd.toFixed(2)}`} sub="Estimated model spend" />
        <StatCard label="Fallbacks" value={m.aiFallbacks} sub="Deterministic safety net used" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Leads received</CardTitle>
              <CardDescription>Per day</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <TrendChart data={m.leadsByDay} xKey="label" yKey="leads" caption="Leads received per day" height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Conversion funnel</CardTitle>
              <CardDescription>Step-to-step conversion on the right</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Funnel steps={m.funnel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Appointments booked</CardTitle>
              <CardDescription>Per week, last 8 weeks</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ColumnChart data={m.appointmentsByWeek} xKey="week" yKey="count" caption="Appointments booked per week" height={190} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Estimated pipeline</CardTitle>
              <CardDescription>Open value by stage</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BarList items={m.pipelineByStage.map((p) => ({ label: `${p.stage} (${p.count})`, value: p.value }))} format={(v) => formatCurrency(v, { compact: true })} />
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
            <ColumnChart data={m.scoreBuckets.map((b) => ({ bucket: b.bucket, count: b.count }))} xKey="bucket" yKey="count" colors={SEQ_RAMP} caption="Open leads by score tier" height={190} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lead source</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList items={m.bySource.map((s) => ({ label: s.source, value: s.leads }))} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>AI usage by agent</CardTitle>
              <CardDescription>Runs, deterministic fallbacks, latency and estimated cost — for per-client cost control</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-foreground-subtle">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 font-medium">Agent</th>
                  <th scope="col" className="py-2 text-right font-medium">Runs</th>
                  <th scope="col" className="py-2 text-right font-medium">Fallbacks</th>
                  <th scope="col" className="py-2 text-right font-medium">Avg latency</th>
                  <th scope="col" className="py-2 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {m.agentUsage.map((a) => (
                  <tr key={a.agent}>
                    <td className="py-2 text-foreground">{AGENT_LABELS[a.agent as AgentType] ?? a.agent}</td>
                    <td className="py-2 text-right tabular">{a.runs}</td>
                    <td className={cn("py-2 text-right tabular", a.fallbacks > 0 && "text-warning")}>{a.fallbacks}</td>
                    <td className="py-2 text-right tabular">{a.avgLatencyMs} ms</td>
                    <td className="py-2 text-right tabular">${a.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
