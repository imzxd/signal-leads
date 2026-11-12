import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizationMembers, organizations, profiles, type Organization } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import { ForbiddenError } from "@/server/context";
import type { MemberRole } from "@/types/domain";
import { features } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signToken, verifyToken } from "./signed-cookie";

export const DEMO_COOKIE = "sl_session";
export const ORG_COOKIE = "sl_org";
const DEMO_TTL_MS = 7 * 86_400_000;

export interface Session {
  userId: string;
  name: string;
  email: string | null;
  role: MemberRole;
  organization: Organization;
  memberships: { organization: Organization; role: MemberRole }[];
  authMethod: "supabase" | "demo";
}

async function resolveUserId(): Promise<{ userId: string; method: "supabase" | "demo" } | null> {
  if (features.supabaseAuth()) {
    const supabase = await createSupabaseServerClient();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (data.user) return { userId: data.user.id, method: "supabase" };
  }
  if (features.demoMode()) {
    const jar = await cookies();
    const payload = verifyToken<{ uid: string }>(jar.get(DEMO_COOKIE)?.value);
    if (payload?.uid) return { userId: payload.uid, method: "demo" };
  }
  return null;
}

/**
 * Resolves the signed-in user and their active organization. The organization comes from
 * the user's memberships — a client-supplied org id (cookie) is only honoured if the user
 * is actually a member.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const who = await resolveUserId();
  if (!who) return null;
  const db = await getDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, who.userId)).limit(1);
  if (!profile) return null;
  const rows = await db
    .select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, who.userId));
  if (!rows.length) {
    return null;
  }
  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value;
  const active = rows.find((r) => r.organization.id === wanted) ?? rows[0];
  return {
    userId: who.userId,
    name: profile.fullName ?? profile.email ?? "Team member",
    email: profile.email,
    role: active.role,
    organization: active.organization,
    memberships: rows,
    authMethod: who.method,
  };
});

/** Signed in with Supabase but no organization yet → onboarding. */
export async function hasAuthenticatedUserWithoutOrg(): Promise<boolean> {
  const who = await resolveUserId();
  if (!who) return false;
  const db = await getDb();
  const [m] = await db.select({ id: organizationMembers.id }).from(organizationMembers).where(eq(organizationMembers.userId, who.userId)).limit(1);
  return !m;
}

export async function currentUserId(): Promise<string | null> {
  return (await resolveUserId())?.userId ?? null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    if (await hasAuthenticatedUserWithoutOrg()) redirect("/onboarding");
    redirect("/sign-in");
  }
  return session;
}

/** OrgContext for server actions and server components. */
export async function requireOrgContext(): Promise<{ session: Session; ctx: OrgContext }> {
  const session = await requireSession();
  if (session.organization.status !== "active") throw new ForbiddenError("This organization is suspended");
  const db = await getDb();
  return { session, ctx: { db, organizationId: session.organization.id, actor: { kind: "staff", userId: session.userId, name: session.name } } };
}

export function requireRole(session: Session, roles: MemberRole[]) {
  if (!roles.includes(session.role)) throw new ForbiddenError("Only owners and admins can change this");
}

export async function startDemoSession(userId: string) {
  const jar = await cookies();
  jar.set(DEMO_COOKIE, signToken({ uid: userId, exp: Date.now() + DEMO_TTL_MS }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEMO_TTL_MS / 1000,
  });
}

export async function setActiveOrganization(userId: string, organizationId: string) {
  const db = await getDb();
  const [m] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);
  if (!m) throw new ForbiddenError("You are not a member of that organization");
  const jar = await cookies();
  jar.set(ORG_COOKIE, organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(DEMO_COOKIE);
  jar.delete(ORG_COOKIE);
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
}
