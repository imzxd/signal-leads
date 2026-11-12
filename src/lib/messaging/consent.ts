import { and, desc, eq, isNull } from "drizzle-orm";
import { consents } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import type { ContactChannel } from "@/types/domain";

export async function hasConsent(ctx: OrgContext, leadId: string, channel: ContactChannel): Promise<boolean> {
  const [latest] = await ctx.db
    .select({ granted: consents.granted, revokedAt: consents.revokedAt })
    .from(consents)
    .where(and(eq(consents.organizationId, ctx.organizationId), eq(consents.leadId, leadId), eq(consents.channel, channel)))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return Boolean(latest && latest.granted && !latest.revokedAt);
}

export async function grantConsent(
  ctx: OrgContext,
  leadId: string,
  channels: ContactChannel[],
  source: string,
  evidence: string | null,
  ipAddress: string | null = null,
) {
  if (!channels.length) return;
  await ctx.db.insert(consents).values(
    channels.map((channel) => ({ organizationId: ctx.organizationId, leadId, channel, granted: true, source, evidence, ipAddress })),
  );
}

/** Opt-out applies to every channel and is recorded as an explicit revocation. */
export async function revokeAllConsent(ctx: OrgContext, leadId: string, source: string, evidence: string) {
  const now = new Date();
  await ctx.db
    .update(consents)
    .set({ revokedAt: now })
    .where(and(eq(consents.organizationId, ctx.organizationId), eq(consents.leadId, leadId), isNull(consents.revokedAt)));
  await ctx.db.insert(consents).values(
    (["email", "sms", "web"] as const).map((channel) => ({ organizationId: ctx.organizationId, leadId, channel, granted: false, source, evidence })),
  );
}
