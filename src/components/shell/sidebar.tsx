"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, BookOpen, Columns3, Inbox, LayoutDashboard, Menu, Settings, Users, Workflow, X } from "lucide-react";
import { BrandLogo, KimeEndorsement } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users, badgeKey: "needsHuman" as const },
  { href: "/pipeline", label: "Pipeline", icon: Columns3 },
  { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "unread" as const },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export interface SidebarProps {
  counts: { unread: number; needsHuman: number };
  aiMode: { live: boolean; label: string; detail: string };
  footer: React.ReactNode;
}

function NavList({ counts, onNavigate }: { counts: SidebarProps["counts"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const badge = badgeKey ? counts[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-surface-elevated text-foreground" : "text-foreground-muted hover:bg-surface-hover/60 hover:text-foreground",
            )}
          >
            {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />}
            <Icon className={cn("size-4", active ? "text-accent" : "text-foreground-subtle group-hover:text-foreground-muted")} aria-hidden />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className={cn("rounded-full px-1.5 text-[10px] font-semibold tabular", badgeKey === "needsHuman" ? "bg-temp-hot/20 text-temp-hot" : "bg-accent/15 text-accent")}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function WatchingIndicator({ aiMode }: { aiMode: SidebarProps["aiMode"] }) {
  return (
    <div className="rounded-lg border border-border bg-background-raised/70 p-3" title={aiMode.detail}>
      <div className="flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-pulse-dot rounded-full bg-accent" />
        </span>
        <span className="text-xs font-medium text-foreground">Signal is watching</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-foreground-subtle">
        Agents: <span className={aiMode.live ? "text-accent" : "text-warning"}>{aiMode.label}</span>
      </p>
    </div>
  );
}

export function Sidebar({ counts, aiMode, footer }: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <BrandLogo size="sm" />
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-foreground-muted hover:bg-surface-hover" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-5 border-r border-border bg-background p-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <BrandLogo size="sm" />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-foreground-muted hover:bg-surface-hover" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            <NavList counts={counts} onNavigate={() => setOpen(false)} />
            <div className="mt-auto space-y-3">
              <WatchingIndicator aiMode={aiMode} />
              {footer}
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-border bg-background/60 px-3 py-5 backdrop-blur lg:flex">
        <div className="px-2">
          <BrandLogo size="sm" />
        </div>
        <NavList counts={counts} />
        <div className="mt-auto space-y-3">
          <WatchingIndicator aiMode={aiMode} />
          {footer}
          <div className="px-2">
            <KimeEndorsement />
          </div>
        </div>
      </aside>
    </>
  );
}
