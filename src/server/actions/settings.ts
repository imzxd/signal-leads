"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOrgContext, requireRole } from "@/lib/auth/session";
import { apiKeys, organizations, organizationSettings } from "@/server/db/schema";
import { audit } from "@/server/repositories/audit";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/features/organizations/settings-schemas";
import { act } from "./result";

export async function saveSettingsAction(section: SettingsSection, input: unknown) {
  return act("saveSettings", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    const schema = SETTINGS_SECTIONS[z.enum(Object.keys(SETTINGS_SECTIONS) as [SettingsSection, ...SettingsSection[]]).parse(section)];
    const data = schema.parse(input) as never;
    const where = eq(organizationSettings.organizationId, ctx.organizationId);
    switch (section) {
      case "company": {
        const c = data as z.infer<typeof SETTINGS_SECTIONS.company>;
        await ctx.db.update(organizationSettings).set({ businessName: c.businessName, phone: c.phone, email: c.email, website: c.website, address: c.address, brandVoice: c.brandVoice, averageDealValue: c.averageDealValue }).where(where);
        await ctx.db.update(organizations).set({ timezone: c.timezone, name: c.businessName }).where(eq(organizations.id, ctx.organizationId));
        break;
      }
      case "services":
        await ctx.db.update(organizationSettings).set({ services: data }).where(where);
        break;
      case "serviceArea":
        await ctx.db.update(organizationSettings).set({ serviceArea: data }).where(where);
        break;
      case "qualification":
        await ctx.db.update(organizationSettings).set({ qualificationFields: data }).where(where);
        break;
      case "followUps": {
        const f = data as z.infer<typeof SETTINGS_SECTIONS.followUps>;
        await ctx.db.update(organizationSettings).set({ followUpSequence: f.sequence, messagingHours: f.messagingHours }).where(where);
        break;
      }
      case "escalation":
        await ctx.db.update(organizationSettings).set({ escalationRules: data }).where(where);
        break;
      case "booking":
        await ctx.db.update(organizationSettings).set({ bookingConfig: data }).where(where);
        break;
      case "form":
        await ctx.db.update(organizationSettings).set({ formConfig: data }).where(where);
        break;
    }
    await audit(ctx, `settings.${section}.updated`, "organization", ctx.organizationId);
    revalidatePath("/settings");
  }, "Settings saved.");
}

/** Creates an API key. The plaintext is returned once and only its SHA-256 hash is stored. */
export async function createApiKeyAction(name: string) {
  return act("createApiKey", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    const label = z.string().trim().min(1, "Name the key").max(60).parse(name);
    const secret = `sl_live_${randomBytes(24).toString("base64url")}`;
    const [row] = await ctx.db
      .insert(apiKeys)
      .values({ organizationId: ctx.organizationId, name: label, prefix: secret.slice(0, 12), keyHash: createHash("sha256").update(secret).digest("hex") })
      .returning({ id: apiKeys.id });
    await audit(ctx, "api_key.created", "api_key", row.id, { name: label });
    revalidatePath("/settings");
    return secret;
  });
}

export async function revokeApiKeyAction(id: string) {
  return act("revokeApiKey", async () => {
    const { session, ctx } = await requireOrgContext();
    requireRole(session, ["owner", "admin"]);
    await ctx.db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, z.string().uuid().parse(id)), eq(apiKeys.organizationId, ctx.organizationId)));
    await audit(ctx, "api_key.revoked", "api_key", id);
    revalidatePath("/settings");
  }, "API key revoked.");
}
