import { and, eq, sql } from "drizzle-orm";
import { leadCustomFields, leads, type Lead } from "@/server/db/schema";
import { NotFoundError, type OrgContext } from "@/server/context";
import type { KnownFields } from "@/ai/agents/qualification/agent";

export async function getLead(ctx: OrgContext, leadId: string): Promise<Lead> {
  const [lead] = await ctx.db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, ctx.organizationId)))
    .limit(1);
  if (!lead) throw new NotFoundError("Lead");
  return lead;
}

export async function findLead(ctx: OrgContext, leadId: string): Promise<Lead | null> {
  try {
    return await getLead(ctx, leadId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export type LeadPatch = Partial<Omit<Lead, "id" | "organizationId" | "createdAt" | "updatedAt">>;

export async function updateLead(ctx: OrgContext, leadId: string, patch: LeadPatch): Promise<Lead> {
  if (Object.keys(patch).length === 0) return getLead(ctx, leadId);
  const [lead] = await ctx.db
    .update(leads)
    .set(patch)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, ctx.organizationId)))
    .returning();
  if (!lead) throw new NotFoundError("Lead");
  return lead;
}

export async function getCustomFields(ctx: OrgContext, leadId: string): Promise<Record<string, string>> {
  const rows = await ctx.db
    .select({ key: leadCustomFields.key, value: leadCustomFields.value })
    .from(leadCustomFields)
    .where(and(eq(leadCustomFields.leadId, leadId), eq(leadCustomFields.organizationId, ctx.organizationId)));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function upsertCustomFields(
  ctx: OrgContext,
  leadId: string,
  fields: { key: string; value: string; source: "ai" | "staff" | "form" | "api"; confidence?: number | null }[],
): Promise<void> {
  const valid = fields.filter((f) => /^[a-z][a-z0-9_]{0,63}$/.test(f.key) && f.value.trim());
  if (!valid.length) return;
  await ctx.db
    .insert(leadCustomFields)
    .values(
      valid.map((f) => ({
        organizationId: ctx.organizationId,
        leadId,
        key: f.key,
        value: f.value.trim().slice(0, 500),
        source: f.source,
        confidence: f.confidence ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [leadCustomFields.leadId, leadCustomFields.key],
      set: { value: sql`excluded.value`, source: sql`excluded.source`, confidence: sql`excluded.confidence`, updatedAt: sql`now()` },
    });
}

/** Lead columns that qualification field keys can refer to directly. */
export const LEAD_COLUMN_FIELDS = ["name", "email", "phone", "company", "address", "location", "timeline", "budget"] as const;

export function knownFieldsFor(lead: Lead, custom: Record<string, string>): KnownFields {
  return {
    ...custom,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    address: lead.address ?? custom.address,
    location: lead.location ?? custom.location,
    timeline: lead.timeline ?? custom.timeline,
    budget: lead.budget ?? custom.budget,
    urgency: lead.urgency,
    service: lead.serviceRequested,
    service_key: lead.serviceKey,
  };
}

/** Split extracted {key,value} pairs into lead-column updates and custom fields. */
export function partitionFieldUpdates(lead: Lead, fields: { key: string; value: string }[]) {
  const columns: Partial<Record<(typeof LEAD_COLUMN_FIELDS)[number], string>> = {};
  const custom: { key: string; value: string }[] = [];
  for (const f of fields) {
    if ((LEAD_COLUMN_FIELDS as readonly string[]).includes(f.key)) {
      const key = f.key as (typeof LEAD_COLUMN_FIELDS)[number];
      // Never overwrite verified contact details with model extraction.
      if ((key === "email" || key === "phone" || key === "name") && lead[key]) continue;
      columns[key] = f.value;
    } else {
      custom.push(f);
    }
  }
  return { columns, custom };
}
