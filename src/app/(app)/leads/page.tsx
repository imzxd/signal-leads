import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { requireOrgContext } from "@/lib/auth/session";
import { leadListQuerySchema, listLeads, type LeadListQuery } from "@/server/repositories/lead-list";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { ControlBadge, ScoreMeter, StageBadge, TemperatureBadge } from "@/components/leads/lead-badges";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { SOURCE_LABELS } from "@/types/domain";
import { cn, formatCurrency, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function hrefWith(query: LeadListQuery, patch: Partial<Record<keyof LeadListQuery, string | number | undefined>>) {
  const p = new URLSearchParams();
  const merged = { ...query, ...patch } as Record<string, unknown>;
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && v === 1) || (k === "sort" && v === "created" && merged.dir === "desc") || (k === "dir" && v === "desc" && merged.sort === "created")) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `/leads?${s}` : "/leads";
}

function SortHeader({ query, sort, children, className }: { query: LeadListQuery; sort: LeadListQuery["sort"]; children: React.ReactNode; className?: string }) {
  const active = query.sort === sort;
  const nextDir = active && query.dir === "desc" ? "asc" : "desc";
  return (
    <th scope="col" className={cn("px-3 py-2.5 font-medium", className)} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={hrefWith(query, { sort, dir: nextDir, page: 1 })} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}
        {active && (query.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </th>
  );
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const query = leadListQuerySchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const { ctx } = await requireOrgContext();
  const { rows, total, pageSize } = await listLeads(ctx, query);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const th = "px-3 py-2.5 font-medium";

  return (
    <div>
      <LiveRefresh intervalMs={10000} />
      <PageHeader eyebrow="CRM" title="Leads" description={`${total} lead${total === 1 ? "" : "s"}${query.q ? ` matching “${query.q}”` : ""}`} actions={<NewLeadDialog />} />
      <div className="mb-3">
        <LeadsFilters />
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title="No leads match these filters" description="Try clearing filters, or share your lead form to start collecting leads." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-[13px] [&_td]:whitespace-nowrap">
              <thead className="border-b border-border bg-background-raised/50 text-[11px] uppercase tracking-wider text-foreground-subtle">
                <tr>
                  <SortHeader query={query} sort="name" className="pl-5">
                    Name
                  </SortHeader>
                  <th scope="col" className={th}>Company</th>
                  <th scope="col" className={th}>Service</th>
                  <th scope="col" className={th}>Source</th>
                  <SortHeader query={query} sort="score">Score</SortHeader>
                  <th scope="col" className={th}>Temperature</th>
                  <th scope="col" className={th}>Stage</th>
                  <SortHeader query={query} sort="lastContact">Last contact</SortHeader>
                  <th scope="col" className={th}>Next action</th>
                  <th scope="col" className={th}>Assigned to</th>
                  <SortHeader query={query} sort="value" className="pr-5 text-right">
                    Est. value
                  </SortHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map(({ lead, assigneeName }) => (
                  <tr key={lead.id} className="group relative hover:bg-surface-hover/40">
                    <td className="py-2.5 pl-5 pr-3">
                      <Link href={`/leads/${lead.id}`} className="block after:absolute after:inset-0 focus:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ring">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground group-hover:text-accent">{lead.name ?? "Unnamed lead"}</span>
                          {lead.controlMode !== "autopilot" && <ControlBadge mode={lead.controlMode} />}
                        </span>
                        <span className="block text-[11px] text-foreground-subtle">{lead.email ?? lead.phone ?? "—"}</span>
                      </Link>
                    </td>
                    <td className="px-3 text-foreground-muted">{lead.company ?? "—"}</td>
                    <td className="max-w-[160px] truncate px-3 text-foreground-muted">{lead.serviceRequested ?? "—"}</td>
                    <td className="px-3 text-foreground-muted">{SOURCE_LABELS[lead.source]}</td>
                    <td className="px-3">
                      <ScoreMeter score={lead.score} />
                    </td>
                    <td className="px-3">
                      <TemperatureBadge temperature={lead.temperature} />
                    </td>
                    <td className="px-3">
                      <StageBadge stage={lead.stage} />
                    </td>
                    <td className="px-3 text-foreground-muted tabular">{relativeTime(lead.lastContactAt)}</td>
                    <td className="max-w-[200px] truncate px-3 text-xs text-foreground-muted">{lead.nextAction ?? "—"}</td>
                    <td className="px-3 text-foreground-muted">{assigneeName ?? <span className="text-foreground-subtle">Signal</span>}</td>
                    <td className="py-2.5 pl-3 pr-5 text-right tabular">{formatCurrency(lead.estimatedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-foreground-muted">
            <span>
              Page {query.page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button asChild variant="secondary" size="sm" aria-disabled={query.page <= 1} className={cn(query.page <= 1 && "pointer-events-none opacity-40")}>
                <Link href={hrefWith(query, { page: query.page - 1 })}>
                  <ChevronLeft /> Previous
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm" aria-disabled={query.page >= pages} className={cn(query.page >= pages && "pointer-events-none opacity-40")}>
                <Link href={hrefWith(query, { page: query.page + 1 })}>
                  Next <ChevronRight />
                </Link>
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
