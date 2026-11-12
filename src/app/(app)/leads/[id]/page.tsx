import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Mail, MapPin, Phone, Radio } from "lucide-react";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/session";
import { loadLeadDetail } from "@/server/services/lead-detail";
import { ActivityTimeline } from "@/components/leads/activity-timeline";
import { LeadIntelligence } from "@/components/leads/lead-intelligence";
import { LeadControls } from "@/components/leads/lead-controls";
import { Composer } from "@/components/leads/composer";
import { ControlBadge, StageBadge, TemperatureBadge } from "@/components/leads/lead-badges";
import { Card } from "@/components/ui/primitives";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { MarkRead } from "@/components/leads/mark-read";
import { SOURCE_LABELS } from "@/types/domain";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { session, ctx } = await requireOrgContext();
  const data = await loadLeadDetail(ctx, id);
  if (!data) notFound();
  const { lead, settings } = data;
  const tz = settings.organization.timezone;

  return (
    <div className="space-y-4">
      <LiveRefresh intervalMs={5000} />
      <MarkRead leadId={lead.id} />
      <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
        <ChevronLeft className="size-3.5" /> All leads
      </Link>

      <Card className="p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl leading-tight">{lead.name ?? "Unnamed lead"}</h1>
              <ControlBadge mode={lead.controlMode} />
            </div>
            {lead.company && <p className="text-sm text-foreground-muted">{lead.company}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="size-3.5" aria-hidden /> {lead.email}
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-3.5" aria-hidden /> {lead.phone}
                </a>
              )}
              {(lead.address || lead.location) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" aria-hidden /> {[lead.address, lead.location].filter(Boolean).join(", ")}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Radio className="size-3.5" aria-hidden /> {SOURCE_LABELS[lead.source]} · {formatDateTime(lead.createdAt, tz)}
              </span>
            </div>
          </div>

          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-foreground-subtle">Score</dt>
              <dd className="font-display text-3xl leading-none tabular">{lead.score}</dd>
            </div>
            <div>
              <dt className="mb-1 text-[11px] text-foreground-subtle">Temperature</dt>
              <dd>
                <TemperatureBadge temperature={lead.temperature} />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-[11px] text-foreground-subtle">Stage</dt>
              <dd>
                <StageBadge stage={lead.stage} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-foreground-subtle">Est. value</dt>
              <dd className="font-display text-2xl leading-none tabular">{formatCurrency(lead.wonValue ?? lead.estimatedValue, { compact: true })}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <LeadControls
            leadId={lead.id}
            controlMode={lead.controlMode}
            stage={lead.stage}
            score={lead.score}
            estimatedValue={lead.estimatedValue}
            assignedTo={lead.assignedTo}
            team={data.team.map((t) => ({ id: t.id, name: t.name }))}
            isDemo={session.organization.isDemo}
            hasScheduledFollowUp={data.followUps.some((f) => f.status === "scheduled")}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="p-5">
            <ActivityTimeline items={data.timeline} timeZone={tz} />
          </Card>
          <Composer leadId={lead.id} controlMode={lead.controlMode} isDemo={session.organization.isDemo} optedOut={Boolean(lead.optedOutAt)} />
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <LeadIntelligence
            lead={lead}
            custom={data.custom}
            fields={settings.qualificationFields}
            score={data.score}
            followUps={data.followUps}
            appointments={data.appointments}
            assigneeName={data.assigneeName}
            timeZone={tz}
          />
        </aside>
      </div>
    </div>
  );
}
