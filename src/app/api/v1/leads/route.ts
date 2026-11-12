import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { leadSubmissionSchema } from "@/features/leads/intake-schema";
import { createInboundLead } from "@/server/services/lead-intake";
import { handleInboundMessage, handleNewLead } from "@/ai/orchestrator";
import { authenticateApiKey, clientIp } from "@/lib/security/api-auth";
import { rateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/observability/logger";

/**
 * POST /api/v1/leads — create a lead from your own systems.
 * Auth: Authorization: Bearer <API key from Settings → API keys>. The organization comes
 * from the key, never from the request body.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const auth = await authenticateApiKey(db, req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!rateLimit(`api:${auth.keyId}`, 120, 60_000).allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = leadSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: z.treeifyError(parsed.error) }, { status: 422 });
  }
  const ctx = { db, organizationId: auth.organizationId, actor: { kind: "api" as const, keyId: auth.keyId, label: `API: ${auth.name}` } };
  try {
    const result = await createInboundLead(ctx, parsed.data, { source: "api", ipAddress: clientIp(req.headers), consentText: parsed.data.consent ? "Consent asserted by API client" : undefined });
    after(() => (result.isNew ? handleNewLead(ctx, result.leadId) : handleInboundMessage(ctx, result.leadId, result.messageId)));
    return NextResponse.json({ leadId: result.leadId, created: result.isNew }, { status: result.isNew ? 201 : 200 });
  } catch (e) {
    logger.error("api.create_lead_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Could not create lead" }, { status: 500 });
  }
}
