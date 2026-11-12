import { Bot, CircleSlash, StickyNote } from "lucide-react";
import type { TimelineItem } from "@/components/leads/activity-timeline";
import { EventIcon } from "@/components/leads/event-icon";
import { cn, formatDateTime } from "@/lib/utils";

/** Key decisions worth surfacing inline in the inbox thread (the full log lives on the lead page). */
const INLINE_EVENTS = new Set(["handoff_requested", "appointment_created", "lead_recovered", "opted_out", "takeover", "returned_to_signal", "converted", "knowledge_escalated", "error"]);

export function InboxThread({ items, timeZone }: { items: TimelineItem[]; timeZone: string }) {
  const visible = items.filter((i) => i.kind === "message" || INLINE_EVENTS.has(i.type));
  if (!visible.length) return <p className="text-sm text-foreground-muted">No messages yet.</p>;
  return (
    <ol className="space-y-3">
      {visible.map((item) => {
        if (item.kind === "event") {
          return (
            <li key={item.id} className="flex items-center justify-center gap-2 py-1 text-[11px] text-foreground-subtle">
              <EventIcon type={item.type} className="size-3" />
              {item.title} · {formatDateTime(item.at, timeZone)}
            </li>
          );
        }
        const inbound = item.direction === "inbound";
        const note = item.direction === "internal";
        return (
          <li key={item.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl border px-3.5 py-2.5",
                inbound && "rounded-bl-sm border-border bg-surface-elevated",
                !inbound && !note && item.authorType === "ai" && "rounded-br-sm border-accent/25 bg-accent/[0.07]",
                !inbound && !note && item.authorType === "staff" && "rounded-br-sm border-warning/25 bg-warning/[0.06]",
                note && "border-dashed border-warning/40",
                (item.status === "blocked" || item.status === "failed") && "opacity-60",
              )}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                {item.authorType === "ai" && <Bot className="size-3 text-accent" aria-hidden />}
                {note && <StickyNote className="size-3 text-warning" aria-hidden />}
                <span className="font-medium text-foreground-muted">{note ? `Note · ${item.authorLabel}` : item.authorLabel}</span>
                <span>· {formatDateTime(item.at, timeZone)}</span>
                {item.status === "blocked" && (
                  <span className="inline-flex items-center gap-1 text-temp-hot">
                    <CircleSlash className="size-3" /> not sent
                  </span>
                )}
              </div>
              <p className="whitespace-pre-line text-sm leading-relaxed">{item.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
