import Link from "next/link";
import { and, count, eq, gt } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { conversations, leads } from "@/server/db/schema";
import { listNotifications } from "@/server/repositories/notifications";
import { describeAIMode } from "@/ai/providers";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { NotificationsMenu } from "@/components/shell/notifications-menu";
import { TooltipProvider } from "@/components/ui/overlays";
import { Badge } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx } = await requireOrgContext();
  const [[unread], [needsHuman], notes] = await Promise.all([
    ctx.db.select({ n: count() }).from(conversations).where(and(eq(conversations.organizationId, ctx.organizationId), gt(conversations.unreadCount, 0))),
    ctx.db.select({ n: count() }).from(leads).where(and(eq(leads.organizationId, ctx.organizationId), eq(leads.stage, "needs_human"))),
    listNotifications(ctx, session.userId, 25),
  ]);
  const aiMode = describeAIMode();

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar
          counts={{ unread: unread?.n ?? 0, needsHuman: needsHuman?.n ?? 0 }}
          aiMode={aiMode}
          footer={
            <UserMenu
              name={session.name}
              email={session.email}
              organizationId={session.organization.id}
              organizationName={session.organization.name}
              formSlug={session.organization.slug}
              memberships={session.memberships.map((m) => ({ id: m.organization.id, name: m.organization.name }))}
            />
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-end gap-2 px-4 pt-4 sm:px-8">
            {session.organization.isDemo && (
              <Badge tone="lime" className="mr-auto hidden sm:inline-flex">
                Demo workspace · messages are simulated
              </Badge>
            )}
            <Link
              href={`/forms/${session.organization.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
            >
              Lead form <ExternalLink className="size-3.5" />
            </Link>
            <NotificationsMenu
              items={notes.map((n) => ({ id: n.id, type: n.type, priority: n.priority, title: n.title, body: n.body, leadId: n.leadId, createdAt: n.createdAt.toISOString(), read: Boolean(n.readAt) }))}
            />
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-4 sm:px-8">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
