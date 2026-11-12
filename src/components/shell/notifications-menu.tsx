"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, CalendarCheck, Flame, LifeBuoy, MessageSquare, TriangleAlert } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/overlays";
import { cn, relativeTime } from "@/lib/utils";
import { markNotificationsRead } from "@/server/actions/notifications";

export interface NotificationItem {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  leadId: string | null;
  createdAt: string;
  read: boolean;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hot_lead: Flame,
  appointment: CalendarCheck,
  handoff: LifeBuoy,
  reply: MessageSquare,
  automation_error: TriangleAlert,
};

export function NotificationsMenu({ items }: { items: NotificationItem[] }) {
  const unread = items.filter((n) => !n.read).length;
  const [pending, start] = useTransition();
  return (
    <DropdownMenu onOpenChange={(open) => !open && unread > 0 && start(() => markNotificationsRead())}>
      <DropdownMenuTrigger className="relative rounded-md border border-border bg-surface/60 p-2 text-foreground-muted hover:border-border-strong hover:text-foreground" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-temp-hot text-[9px] font-bold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {pending && <span className="text-[11px] text-foreground-subtle">Updating…</span>}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-foreground-muted">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              const content = (
                <div className={cn("flex gap-3 border-b border-border/60 px-3 py-2.5 hover:bg-surface-hover", !n.read && "bg-accent/[0.04]")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", n.priority === "urgent" ? "text-temp-hot" : n.priority === "high" ? "text-warning" : "text-foreground-muted")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground-muted">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-foreground-subtle">{relativeTime(n.createdAt)}</p>
                  </div>
                  {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </div>
              );
              return n.leadId ? (
                <Link key={n.id} href={`/leads/${n.leadId}`} className="block">
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
