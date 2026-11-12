import { eq } from "drizzle-orm";
import { createPglite, setDatabaseHandle, type DatabaseHandle } from "@/server/db/client";
import { applyMigrations } from "@/server/db/migrate";
import { organizations, organizationMembers, organizationSettings, automations, profiles } from "@/server/db/schema";
import { seedDemoOrganization } from "@/server/seed/demo";
import { DEFAULT_AUTOMATIONS } from "@/server/repositories/automations";
import { DEFAULT_FORM, DEFAULT_HOURS } from "@/server/repositories/settings";
import { DEMO_QUALIFICATION_FIELDS, DEMO_SERVICE_AREA, DEMO_SERVICES } from "@/server/seed/demo-config";
import { DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import type { OrgContext } from "@/server/context";

/** Fresh in-memory Postgres with all migrations applied (same SQL as production). */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const handle = await createPglite("memory://");
  await applyMigrations(handle.raw, { includeLocalShim: true });
  setDatabaseHandle(Promise.resolve(handle));
  return handle;
}

export async function seedDemo(handle: DatabaseHandle, ownerId = "00000000-0000-4000-8000-000000000001") {
  return seedDemoOrganization(handle.db, { slug: "evergreen-roofing", ownerUserId: ownerId, ownerName: "Alex Morgan", ownerEmail: "alex@example.com" });
}

/** A minimal roofing org with no leads — for precise workflow tests. */
export async function createOrg(handle: DatabaseHandle, opts: { slug: string; ownerId: string; isDemo?: boolean; messagingHours?: boolean }) {
  const db = handle.db;
  const [org] = await db.insert(organizations).values({ name: opts.slug, slug: opts.slug, isDemo: opts.isDemo ?? true, industry: "Roofing contractor" }).returning();
  await db.insert(profiles).values({ id: opts.ownerId, email: `${opts.slug}@example.com`, fullName: `Owner ${opts.slug}` }).onConflictDoNothing();
  await db.insert(organizationMembers).values({ organizationId: org.id, userId: opts.ownerId, role: "owner" });
  await db.insert(organizationSettings).values({
    organizationId: org.id,
    businessName: `Test Roofing ${opts.slug}`,
    services: DEMO_SERVICES,
    serviceArea: DEMO_SERVICE_AREA,
    qualificationFields: DEMO_QUALIFICATION_FIELDS,
    businessHours: DEFAULT_HOURS,
    messagingHours: { enabled: opts.messagingHours ?? false, start: "08:00", end: "20:00" },
    scoringWeights: {},
    escalationRules: DEFAULT_ESCALATION_RULES,
    bookingConfig: { durationMinutes: 60, slotsToOffer: 3, minLeadTimeHours: 2, appointmentLabel: "Estimate" },
    formConfig: DEFAULT_FORM,
  });
  await db.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a, organizationId: org.id })));
  return org;
}

export function staffCtx(handle: DatabaseHandle, organizationId: string, userId: string): OrgContext {
  return { db: handle.db, organizationId, actor: { kind: "staff", userId, name: "Test Staff" } };
}

export function systemCtx(handle: DatabaseHandle, organizationId: string): OrgContext {
  return { db: handle.db, organizationId, actor: { kind: "system", label: "Test" } };
}

export async function orgBySlug(handle: DatabaseHandle, slug: string) {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return org;
}
