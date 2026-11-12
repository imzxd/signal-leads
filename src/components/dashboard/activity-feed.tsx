import Link from "next/link";
import { cn, relativeTime } from "@/lib/utils";
import { EventIcon, eventTone } from "@/components/leads/event-icon";

export interface FeedItem {
  id: string;
  leadId: string;
  leadName: string | null;
  type: string;
  actor: string;
  actorLabel: string;
  title: string;
  createdAt: Date;
}

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((e) => (
        <li key={e.id}>
          <Link href={`/leads/${e.leadId}`} className="flex items-start gap-3 px-5 py-2.5 hover:bg-surface-hover/50">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border", eventTone(e.type, e.actor))}>
              <EventIcon type={e.type} className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-foreground">{e.title}</span>
              <span className="block truncate text-[11px] text-foreground-subtle">
                {e.leadName ?? "Lead"} · {e.actorLabel}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-foreground-subtle tabular">{relativeTime(e.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
