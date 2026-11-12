import type { Metadata } from "next";
import { and, desc, eq, gte, ne, or, notInArray } from "drizzle-orm";
import { requireOrgContext } from "@/lib/auth/session";
import { leads } from "@/server/db/schema";
import { PageHeader } from "@/components/ui/primitives";
import { PipelineBoard, type PipelineCard } from "@/components/pipeline/pipeline-board";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { pipelineColumnFor } from "@/ai/orchestrator/decide";
import { PIPELINE_COLUMNS } from "@/types/domain";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Pipeline" };

/** Closed leads stay on the board for 60 days. */
function closedCutoff() {
  return new Date(Date.now() - 60 * 86_400_000);
}

export default async function PipelinePage() {
  const { ctx } = await requireOrgContext();
  const recent = closedCutoff();
  const rows = await ctx.db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, ctx.organizationId), ne(leads.stage, "archived"), or(notInArray(leads.stage, ["won", "lost"]), gte(leads.updatedAt, recent))))
    .orderBy(desc(leads.score));

  const cards: PipelineCard[] = rows.flatMap((l) => {
    const column = pipelineColumnFor(l.stage, l.temperature);
    return column
      ? [{ id: l.id, name: l.name ?? "Unnamed lead", service: l.serviceRequested, score: l.score, value: l.wonValue ?? l.estimatedValue, lastActivity: (l.lastContactAt ?? l.createdAt).toISOString(), nextAction: l.nextAction, column, stage: l.stage, controlMode: l.controlMode }]
      : [];
  });
  const open = cards.filter((c) => !["won", "lost"].includes(c.column));

  return (
    <div>
      <LiveRefresh intervalMs={12000} />
      <PageHeader eyebrow="Pipeline" title="Pipeline" description={`${open.length} open leads · ${formatCurrency(open.reduce((s, c) => s + (c.value ?? 0), 0))} estimated value. Drag a card to change its stage.`} />
      <PipelineBoard columns={[...PIPELINE_COLUMNS]} initial={cards} />
    </div>
  );
}
