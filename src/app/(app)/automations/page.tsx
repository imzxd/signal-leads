import type { Metadata } from "next";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { ArrowRight, CircleAlert, Clock, Filter, Zap } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { automationRuns, automations, followUps } from "@/server/db/schema";
import { queryRows } from "@/server/db/client";
import { getSettings } from "@/server/repositories/settings";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { AutomationToggle, RunFollowUpsButton } from "@/components/automation/automation-controls";
import { formatPercent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const { session, ctx } = await requireOrgContext();
  const canEdit = session.role !== "member";
  const [rows, stats, errors, [scheduled], [nextDue], settings] = await Promise.all([
    ctx.db.select().from(automations).where(eq(automations.organizationId, ctx.organizationId)).orderBy(asc(automations.createdAt)),
    queryRows<{ automation_id: string; total: number; ok: number; failed: number; last_at: string | null }>(
      ctx.db,
      sql`select automation_id, count(*)::int as total, count(*) filter (where status = 'succeeded')::int as ok,
                 count(*) filter (where status = 'failed')::int as failed, max(created_at) as last_at
          from automation_runs where organization_id = ${ctx.organizationId} group by automation_id`,
    ),
    ctx.db
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.organizationId, ctx.organizationId), eq(automationRuns.status, "failed")))
      .orderBy(desc(automationRuns.createdAt))
      .limit(30),
    ctx.db.select({ n: count() }).from(followUps).where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.status, "scheduled"))),
    ctx.db.select({ at: followUps.scheduledFor }).from(followUps).where(and(eq(followUps.organizationId, ctx.organizationId), eq(followUps.status, "scheduled"))).orderBy(asc(followUps.scheduledFor)).limit(1),
    getSettings(ctx),
  ]);
  const statMap = new Map(stats.map((s) => [s.automation_id, s]));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Automations" title="Automations" description="What Signal is allowed to do on its own. Every action is logged on the lead's timeline." />

      <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <Clock className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-medium">Follow-up engine</h2>
            <p className="text-xs text-foreground-muted">
              {scheduled?.n ?? 0} follow-ups scheduled{nextDue?.at ? ` · next ${relativeTime(nextDue.at)}` : ""} · sequence +{settings.followUpSequence.map((s) => (s.delayHours % 24 === 0 ? `${s.delayHours / 24}d` : `${s.delayHours}h`)).join(", +")}
              {settings.messagingHours.enabled ? ` · sends between ${settings.messagingHours.start}–${settings.messagingHours.end}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-foreground-subtle">Restart-safe and idempotent: a follow-up is never sent twice, and stops the moment a lead replies, opts out, books or is closed.</p>
          </div>
        </div>
        <RunFollowUpsButton />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((a) => {
          const s = statMap.get(a.id);
          const rate = s && s.ok + s.failed > 0 ? s.ok / (s.ok + s.failed) : null;
          const recentErrors = errors.filter((e) => e.automationId === a.id).slice(0, 2);
          return (
            <Card key={a.id} className={a.enabled ? "" : "opacity-75"}>
              <div className="flex items-start justify-between gap-4 px-5 pt-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-lg">{a.name}</h2>
                    {a.enabled ? <Badge tone="lime">On</Badge> : <Badge tone="warning">Paused</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-foreground-muted">{a.description}</p>
                </div>
                <AutomationToggle id={a.id} enabled={a.enabled} name={a.name} canEdit={canEdit} />
              </div>
              <div className="grid gap-3 px-5 py-4 text-xs sm:grid-cols-3">
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-kime">
                    <Zap className="size-3" /> Trigger
                  </p>
                  <p className="text-foreground">{a.trigger}</p>
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-kime">
                    <Filter className="size-3" /> Conditions
                  </p>
                  <ul className="space-y-0.5 text-foreground-muted">
                    {a.conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-kime">
                    <ArrowRight className="size-3" /> Actions
                  </p>
                  <ol className="space-y-0.5 text-foreground-muted">
                    {a.actions.map((c, i) => (
                      <li key={c}>
                        {i + 1}. {c}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-5 py-3 text-[11px] text-foreground-subtle">
                <span>
                  Last run: <span className="text-foreground">{s?.last_at ? relativeTime(new Date(s.last_at)) : "never"}</span>
                </span>
                <span>
                  Runs: <span className="text-foreground tabular">{s?.total ?? 0}</span>
                </span>
                <span>
                  Success rate: <span className="text-foreground tabular">{formatPercent(rate)}</span>
                </span>
                {recentErrors.length > 0 ? (
                  <span className="flex items-center gap-1 text-danger" title={recentErrors.map((e) => e.error).join("\n")}>
                    <CircleAlert className="size-3" /> {recentErrors.length} recent error{recentErrors.length > 1 ? "s" : ""}: {recentErrors[0].error}
                  </span>
                ) : (
                  <span>No recent errors</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
