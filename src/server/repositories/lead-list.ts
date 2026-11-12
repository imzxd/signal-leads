import { and, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { leads, profiles } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { CONTROL_MODES, LEAD_SOURCES, LEAD_STAGES, TEMPERATURES } from "@/types/domain";

export const leadListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  temperature: z.enum(TEMPERATURES).optional().catch(undefined),
  stage: z.enum(LEAD_STAGES).optional().catch(undefined),
  source: z.enum(LEAD_SOURCES).optional().catch(undefined),
  control: z.enum(CONTROL_MODES).optional().catch(undefined),
  sort: z.enum(["created", "name", "score", "lastContact", "value"]).default("created").catch("created"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  archived: z.enum(["1"]).optional().catch(undefined),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const PAGE_SIZE = 15;

export async function listLeads(ctx: OrgContext, q: LeadListQuery) {
  const conditions: (SQL | undefined)[] = [eq(leads.organizationId, ctx.organizationId)];
  if (q.q) {
    const term = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(leads.name, term), ilike(leads.email, term), ilike(leads.phone, term), ilike(leads.company, term), ilike(leads.serviceRequested, term), ilike(leads.location, term)));
  }
  if (q.temperature) conditions.push(eq(leads.temperature, q.temperature));
  if (q.stage) conditions.push(eq(leads.stage, q.stage));
  else if (!q.archived) conditions.push(ne(leads.stage, "archived"));
  if (q.source) conditions.push(eq(leads.source, q.source));
  if (q.control) conditions.push(eq(leads.controlMode, q.control));
  const where = and(...conditions);

  const sortCol = {
    created: leads.createdAt,
    name: leads.name,
    score: leads.score,
    lastContact: leads.lastContactAt,
    value: leads.estimatedValue,
  }[q.sort];
  const order = q.dir === "asc" ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`;

  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({ lead: leads, assigneeName: profiles.fullName })
      .from(leads)
      .leftJoin(profiles, eq(profiles.id, leads.assignedTo))
      .where(where)
      .orderBy(order, desc(leads.id))
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE),
    ctx.db.select({ n: count() }).from(leads).where(where),
  ]);
  return { rows, total: total?.n ?? 0, pageSize: PAGE_SIZE };
}

export async function listTeam(ctx: OrgContext) {
  const { organizationMembers } = await import("@/server/db/schema");
  return ctx.db
    .select({ id: profiles.id, name: profiles.fullName, email: profiles.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, ctx.organizationId));
}

export async function leadsByIds(ctx: OrgContext, ids: string[]) {
  if (!ids.length) return [];
  return ctx.db.select().from(leads).where(and(eq(leads.organizationId, ctx.organizationId), inArray(leads.id, ids)));
}
