"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizationMembers, organizations, organizationSettings, automations, profiles } from "@/server/db/schema";
import { ensureDemoOrganization, seedDemoOrganization } from "@/server/seed/demo";
import { DEMO_ORG_SLUG, DEMO_OWNER_ID } from "@/server/seed/demo-config";
import { DEFAULT_AUTOMATIONS } from "@/server/repositories/automations";
import { DEFAULT_FORM, DEFAULT_HOURS } from "@/server/repositories/settings";
import { DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import { clearSession, currentUserId, setActiveOrganization, startDemoSession } from "@/lib/auth/session";
import { features } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { headers } from "next/headers";

export async function enterDemoWorkspace() {
  if (!features.demoMode()) throw new Error("Demo mode is disabled");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`demo-signin:${ip}`, 20, 60_000).allowed) throw new Error("Too many attempts — try again in a minute");
  const db = await getDb();
  const orgId = await ensureDemoOrganization(db);
  await startDemoSession(DEMO_OWNER_ID);
  await setActiveOrganization(DEMO_OWNER_ID, orgId).catch(() => undefined);
  redirect("/overview");
}

export async function signOut() {
  await clearSession();
  redirect("/sign-in");
}

const orgSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  industry: z.string().trim().max(80).optional(),
});

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "business";
}

export async function createOrganization(_: unknown, formData: FormData): Promise<{ error?: string }> {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  const parsed = orgSchema.safeParse({ name: formData.get("name"), industry: formData.get("industry") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const db = await getDb();
  await db.insert(profiles).values({ id: userId }).onConflictDoNothing();
  let slug = slugify(parsed.data.name);
  for (let i = 0; i < 5; i++) {
    const [exists] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!exists) break;
    slug = `${slugify(parsed.data.name).slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: parsed.data.name, slug, industry: parsed.data.industry ?? null }).returning();
    await tx.insert(organizationMembers).values({ organizationId: org.id, userId, role: "owner" });
    await tx.insert(organizationSettings).values({
      organizationId: org.id,
      businessName: parsed.data.name,
      serviceArea: { cities: [], postalPrefixes: [] },
      businessHours: DEFAULT_HOURS,
      messagingHours: { enabled: true, start: "08:00", end: "20:00" },
      scoringWeights: {},
      escalationRules: DEFAULT_ESCALATION_RULES,
      bookingConfig: {},
      formConfig: DEFAULT_FORM,
    });
    await tx.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a, organizationId: org.id })));
    return org.id;
  });
  await setActiveOrganization(userId, orgId);
  redirect("/settings?welcome=1");
}

export async function createDemoWorkspaceForUser() {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  const db = await getDb();
  await db.insert(profiles).values({ id: userId }).onConflictDoNothing();
  const orgId = await seedDemoOrganization(db, { slug: `${DEMO_ORG_SLUG}-${userId.slice(0, 8)}`, ownerUserId: userId, ownerName: "You", ownerEmail: "" });
  await setActiveOrganization(userId, orgId);
  redirect("/overview");
}

export async function switchOrganization(organizationId: string) {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  await setActiveOrganization(userId, z.string().uuid().parse(organizationId));
  redirect("/overview");
}
