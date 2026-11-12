import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { Inbox as InboxIcon, LifeBuoy } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { latestConversations } from "@/server/repositories/conversations";
import { queryRows } from "@/server/db/client";
import { loadLeadDetail } from "@/server/services/lead-detail";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ChannelBadge, ControlBadge, StageBadge, TemperatureBadge } from "@/components/leads/lead-badges";
import { Composer } from "@/components/leads/composer";
import { LeadIntelligence } from "@/components/leads/lead-intelligence";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { MarkRead } from "@/components/leads/mark-read";
import { InboxThread } from "@/components/inbox/inbox-thread";
import { cn, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; filter?: string }> }) {
  const { c, filter } = await searchParams;
  const { session, ctx } = await requireOrgContext();
  const all = await latestConversations(ctx, 80);
  const previews = await queryRows<{ conversation_id: string; body: string; direction: string; author_type: string }>(
    ctx.db,
    sql`select distinct on (conversation_id) conversation_id, body, direction, author_type
        from messages where organization_id = ${ctx.organizationId} and direction <> 'internal'
        order by conversation_id, created_at desc`,
  );
  const preview = new Map(previews.map((p) => [p.conversation_id, p]));
  const list = all.filter(({ conversation, lead }) => (filter === "unread" ? conversation.unreadCount > 0 : filter === "human" ? lead.controlMode !== "autopilot" || lead.stage === "needs_human" : lead.stage !== "archived"));
  const selectedId = c && z.string().uuid().safeParse(c).success ? c : list[0]?.lead.id;
  const detail = selectedId ? await loadLeadDetail(ctx, selectedId) : null;
  const tz = session.organization.timezone;

  const filters = [
    { id: undefined, label: "All" },
    { id: "unread", label: "Unread" },
    { id: "human", label: "Needs a person" },
  ];

  return (
    <div>
      <LiveRefresh intervalMs={6000} />
      <PageHeader eyebrow="Inbox" title="Inbox" description="Every conversation across web, email and SMS — Signal drafts, you stay in control." />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
        <Card className="flex max-h-[calc(100vh-200px)] flex-col overflow-hidden">
          <div className="flex gap-1 border-b border-border p-2">
            {filters.map((f) => (
              <Link
                key={f.label}
                href={f.id ? `/inbox?filter=${f.id}` : "/inbox"}
                className={cn("rounded-md px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground", filter === f.id && "bg-surface-elevated text-foreground")}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <ul className="flex-1 divide-y divide-border/60 overflow-y-auto">
            {list.length === 0 && <EmptyState icon={<InboxIcon />} title="No conversations here" />}
            {list.map(({ conversation, lead }) => {
              const p = preview.get(conversation.id);
              const active = lead.id === selectedId;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/inbox?c=${lead.id}${filter ? `&filter=${filter}` : ""}`}
                    aria-current={active ? "true" : undefined}
                    className={cn("block px-3 py-2.5 hover:bg-surface-hover/50", active && "bg-surface-elevated/80 shadow-[inset_3px_0_0_var(--accent)]")}
                  >
                    <div className="flex items-center gap-2">
                      {conversation.unreadCount > 0 && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      <span className={cn("min-w-0 flex-1 truncate text-sm", conversation.unreadCount > 0 ? "font-semibold text-foreground" : "text-foreground")}>{lead.name ?? "Unnamed lead"}</span>
                      {lead.stage === "needs_human" && <LifeBuoy className="size-3.5 text-temp-hot" aria-label="Needs human" />}
                      <span className="shrink-0 text-[10px] text-foreground-subtle">{relativeTime(conversation.lastMessageAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-foreground-muted">
                      {p ? `${p.direction === "inbound" ? "" : p.author_type === "ai" ? "Signal: " : "You: "}${p.body}` : "No messages yet"}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <ChannelBadge channel={lead.preferredChannel} />
                      <TemperatureBadge temperature={lead.temperature} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {detail ? (
          <>
            <div className="flex min-w-0 flex-col gap-3">
              <MarkRead leadId={detail.lead.id} />
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <Link href={`/leads/${detail.lead.id}`} className="font-display text-xl hover:text-accent">
                    {detail.lead.name ?? "Unnamed lead"}
                  </Link>
                  <p className="text-xs text-foreground-muted">{detail.lead.serviceRequested ?? "Inquiry"} · {detail.lead.email ?? detail.lead.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ControlBadge mode={detail.lead.controlMode} />
                  <StageBadge stage={detail.lead.stage} />
                </div>
              </Card>
              <Card className="max-h-[calc(100vh-430px)] min-h-[320px] overflow-y-auto p-5">
                <InboxThread items={detail.timeline} timeZone={tz} />
              </Card>
              <Composer leadId={detail.lead.id} controlMode={detail.lead.controlMode} isDemo={session.organization.isDemo} optedOut={Boolean(detail.lead.optedOutAt)} />
            </div>
            <aside className="hidden max-h-[calc(100vh-200px)] overflow-y-auto xl:block">
              <LeadIntelligence
                lead={detail.lead}
                custom={detail.custom}
                fields={detail.settings.qualificationFields}
                score={detail.score}
                followUps={detail.followUps}
                appointments={detail.appointments}
                assigneeName={detail.assigneeName}
                timeZone={tz}
              />
            </aside>
          </>
        ) : (
          <Card className="xl:col-span-2">
            <EmptyState icon={<InboxIcon />} title="Select a conversation" description="Conversations appear here as soon as a lead gets in touch." />
          </Card>
        )}
      </div>
    </div>
  );
}
