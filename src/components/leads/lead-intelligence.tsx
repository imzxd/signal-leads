import { CalendarCheck, CheckCircle2, Circle, Clock, LifeBuoy, XCircle } from "lucide-react";
import type { Appointment, FollowUp, Lead, LeadScore } from "@/server/db/schema";
import type { QualificationField } from "@/types/domain";
import type { ScoreFactor } from "@/features/leads/scoring/types";
import { STOP_REASON_LABELS, type FollowUpStopReason } from "@/features/follow-ups/stop-conditions";
import { isFieldKnown } from "@/ai/agents/qualification/agent";
import { Card } from "@/components/ui/primitives";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-border px-4 py-3.5 first:border-t-0", className)}>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-kime">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="text-right text-foreground">{value || <span className="text-foreground-subtle">—</span>}</dd>
    </div>
  );
}

const URGENCY_LABEL: Record<string, string> = { emergency: "Emergency", urgent: "Urgent", soon: "Soon", flexible: "Flexible", unknown: "Not stated" };

export function LeadIntelligence({
  lead,
  custom,
  fields,
  score,
  followUps,
  appointments,
  assigneeName,
  timeZone,
}: {
  lead: Lead;
  custom: Record<string, string>;
  fields: QualificationField[];
  score: LeadScore | null;
  followUps: FollowUp[];
  appointments: Appointment[];
  assigneeName: string | null;
  timeZone: string;
}) {
  const known = { ...custom, name: lead.name, email: lead.email, phone: lead.phone, address: lead.address, location: lead.location, timeline: lead.timeline, budget: lead.budget, company: lead.company, urgency: lead.urgency, service: lead.serviceRequested };
  const applicable = fields.filter((f) => !f.services?.length || (lead.serviceKey && f.services.includes(lead.serviceKey)));
  const required = applicable.filter((f) => f.required);
  const done = required.filter((f) => isFieldKnown(f.key, known)).length;
  const pct = required.length ? Math.round((done / required.length) * 100) : 100;
  const factors = (score?.factors ?? []) as ScoreFactor[];
  const appointment = appointments.find((a) => a.status === "confirmed") ?? appointments[appointments.length - 1];
  const pendingFu = followUps.filter((f) => f.status === "scheduled");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-background-raised/50 px-4 py-3">
        <h2 className="text-sm font-medium">Lead intelligence</h2>
        {lead.aiConfidence != null && <span className="text-[11px] text-foreground-subtle">AI confidence {Math.round(lead.aiConfidence * 100)}%</span>}
      </div>

      {lead.handoff?.required && !lead.handoff.resolvedAt && (
        <div className="flex gap-3 border-b border-temp-hot/30 bg-temp-hot/[0.07] px-4 py-3">
          <LifeBuoy className="mt-0.5 size-4 shrink-0 text-temp-hot" aria-hidden />
          <div className="text-xs">
            <p className="font-medium text-temp-hot">Needs you · {lead.handoff.priority} priority</p>
            <p className="mt-1 text-foreground-muted">{lead.handoff.ownerSummary}</p>
          </div>
        </div>
      )}

      <Section title="AI summary">
        <p className="text-sm leading-relaxed text-foreground">{lead.summary ?? "Signal is still reading this lead."}</p>
      </Section>

      <Section title="Details">
        <dl>
          <Fact label="Intent" value={lead.intent?.replace(/_/g, " ")} />
          <Fact label="Service requested" value={lead.serviceRequested} />
          <Fact label="Urgency" value={URGENCY_LABEL[lead.urgency]} />
          <Fact label="Timeline" value={lead.timeline} />
          <Fact label="Budget" value={lead.budget} />
          <Fact label="Location" value={[lead.address, lead.location].filter(Boolean).join(", ")} />
          {Object.entries(custom).map(([k, v]) => (
            <Fact key={k} label={fields.find((f) => f.key === k)?.label ?? k.replace(/_/g, " ")} value={v} />
          ))}
        </dl>
      </Section>

      <Section title={`Qualification · ${pct}% complete`}>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Qualification completeness">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <ul className="space-y-1">
          {applicable.map((f) => {
            const ok = isFieldKnown(f.key, known);
            return (
              <li key={f.key} className="flex items-center gap-2 text-xs">
                {ok ? <CheckCircle2 className="size-3.5 text-accent" aria-label="Known" /> : <Circle className="size-3.5 text-foreground-subtle" aria-label="Missing" />}
                <span className={ok ? "text-foreground" : "text-foreground-muted"}>{f.label}</span>
                {!f.required && <span className="text-[10px] text-foreground-subtle">optional</span>}
                {lead.automationState.pendingField === f.key && <span className="ml-auto text-[10px] text-warning">asked</span>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={`Lead score · ${lead.score}`}>
        {score?.explanation && <p className="mb-2 text-xs text-foreground-muted">{score.explanation}</p>}
        {factors.length > 0 ? (
          <ul className="space-y-1">
            {factors.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground-muted">{f.label}</span>
                <span className={cn("font-medium tabular", f.points >= 0 ? "text-accent" : "text-danger")}>
                  {f.points >= 0 ? "+" : ""}
                  {f.points}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-foreground-subtle">Not scored yet.</p>
        )}
      </Section>

      <Section title="Recommended next action">
        <p className="text-sm text-foreground">{lead.nextAction ?? "—"}</p>
        {lead.nextActionAt && <p className="text-[11px] text-foreground-subtle">{formatDateTime(lead.nextActionAt, timeZone)}</p>}
      </Section>

      <Section title="Appointment">
        {appointment ? (
          <div className="flex items-start gap-2 text-xs">
            <CalendarCheck className="mt-0.5 size-4 text-accent" aria-hidden />
            <div>
              <p className="text-sm text-foreground">{formatDateTime(appointment.startsAt, timeZone)}</p>
              <p className="text-foreground-muted">
                {appointment.title.split(" — ")[0]} · {appointment.status}
              </p>
              {appointment.location && <p className="text-foreground-subtle">{appointment.location}</p>}
              {appointment.provider === "dev-calendar" && <p className="mt-1 text-[10px] text-foreground-subtle">Development calendar (simulated)</p>}
            </div>
          </div>
        ) : lead.bookingState.offeredSlots?.length ? (
          <p className="text-xs text-foreground-muted">Offered {lead.bookingState.offeredSlots.length} times — waiting for the customer to choose.</p>
        ) : (
          <p className="text-xs text-foreground-subtle">None booked.</p>
        )}
      </Section>

      <Section title="Follow-up state">
        {followUps.length === 0 ? (
          <p className="text-xs text-foreground-subtle">No follow-ups scheduled.</p>
        ) : (
          <ul className="space-y-1.5">
            {followUps.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-xs">
                {f.status === "sent" ? (
                  <CheckCircle2 className="size-3.5 text-accent" aria-hidden />
                ) : f.status === "scheduled" ? (
                  <Clock className="size-3.5 text-warning" aria-hidden />
                ) : (
                  <XCircle className="size-3.5 text-foreground-subtle" aria-hidden />
                )}
                <span className="text-foreground">Follow-up {f.sequenceNumber}</span>
                <span className="ml-auto text-right text-foreground-subtle">
                  {f.status === "scheduled"
                    ? `due ${relativeTime(f.scheduledFor)}`
                    : f.status === "sent"
                      ? `sent ${relativeTime(f.executedAt)}`
                      : f.status === "cancelled"
                        ? (STOP_REASON_LABELS[f.cancelReason as FollowUpStopReason] ?? f.cancelReason?.replace(/_/g, " ") ?? "cancelled")
                        : f.status === "failed"
                          ? <span className="text-danger" title={f.lastError ?? undefined}>failed</span>
                          : f.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pendingFu.length > 0 && <p className="mt-2 text-[11px] text-foreground-subtle">Stops automatically the moment they reply.</p>}
      </Section>

      <Section title="Assigned to">
        <p className="text-sm text-foreground">{assigneeName ?? "Signal (no team member yet)"}</p>
      </Section>
    </Card>
  );
}
