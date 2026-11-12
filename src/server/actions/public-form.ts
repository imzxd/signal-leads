"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { getSettings } from "@/server/repositories/settings";
import { createInboundLead } from "@/server/services/lead-intake";
import { handleInboundMessage, handleNewLead } from "@/ai/orchestrator";
import { leadSubmissionSchema } from "@/features/leads/intake-schema";
import { rateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/observability/logger";

export type FormState = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> } | null;

/**
 * Public, unauthenticated lead submission. The organization is resolved from the URL slug
 * (never from a submitted id); input is validated, rate-limited and honeypot-protected.
 */
export async function submitLeadForm(slug: string, input: unknown, embed: boolean): Promise<FormState & { leadId?: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  if (!rateLimit(`form:${slug}:${ip}`, 8, 10 * 60_000).allowed) {
    return { ok: false, error: "Too many submissions — please wait a few minutes and try again." };
  }
  const parsed = leadSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, z.string().max(64).parse(slug))).limit(1);
  if (!org || org.status !== "active") return { ok: false, error: "This form is no longer accepting requests." };

  const ctx = systemContext(db, org.id, "Lead form");
  const settings = await getSettings(ctx);
  try {
    const result = await createInboundLead(ctx, parsed.data, { source: embed ? "embed" : "form", ipAddress: ip, consentText: parsed.data.consent ? settings.form.consentText : undefined });
    // Respond immediately; the orchestrator works in the background (the dashboard updates live).
    after(async () => {
      const r = result.isNew ? await handleNewLead(ctx, result.leadId) : await handleInboundMessage(ctx, result.leadId, result.messageId);
      if (!r.ok) logger.error("form.workflow_failed", { error: r.error });
    });
    return { ok: true };
  } catch (e) {
    logger.error("form.submit_failed", { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "We couldn't send your request. Please try again or call us." };
  }
}
