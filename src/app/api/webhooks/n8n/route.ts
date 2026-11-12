import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { leadSubmissionSchema } from "@/features/leads/intake-schema";
import { createInboundLead, recordChannelReply } from "@/server/services/lead-intake";
import { handleInboundMessage, handleNewLead } from "@/ai/orchestrator";
import { processDueFollowUps } from "@/server/jobs/follow-ups";
import { verifySignature } from "@/lib/integrations/n8n";
import { env } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

/**
 * Signed webhook for n8n workflows (email parsing, Twilio relays, CRM sync, schedulers).
 * Headers: x-signal-timestamp (unix seconds), x-signal-signature = hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
 */
const payloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lead.create"), organizationSlug: z.string().max(64), source: z.enum(["webhook", "email", "sms"]).default("webhook"), data: leadSubmissionSchema }),
  z.object({
    type: z.literal("message.inbound"),
    organizationSlug: z.string().max(64),
    data: z.object({
      from: z.object({ email: z.string().email().optional(), phone: z.string().max(40).optional(), name: z.string().max(120).optional() }).refine((f) => f.email || f.phone, "from.email or from.phone is required"),
      body: z.string().min(1).max(5000),
      channel: z.enum(["email", "sms", "web"]),
      providerMessageId: z.string().max(200).optional(),
    }),
  }),
  z.object({ type: z.literal("followups.run") }),
]);

export async function POST(req: Request) {
  const secret = env().N8N_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "n8n integration is not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-signal-signature"), req.headers.get("x-signal-timestamp"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: z.treeifyError(parsed.error) }, { status: 422 });
  const p = parsed.data;
  const db = await getDb();

  if (p.type === "followups.run") {
    return NextResponse.json(await processDueFollowUps(db));
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, p.organizationSlug)).limit(1);
  if (!org || org.status !== "active") return NextResponse.json({ error: "Unknown organization" }, { status: 404 });
  const ctx = systemContext(db, org.id, "n8n");

  try {
    const result =
      p.type === "lead.create"
        ? await createInboundLead(ctx, p.data, { source: p.source, consentText: p.data.consent ? "Consent captured upstream (n8n)" : undefined })
        : await recordChannelReply(ctx, p.data);
    after(() => (result.isNew ? handleNewLead(ctx, result.leadId) : handleInboundMessage(ctx, result.leadId, result.messageId)));
    return NextResponse.json({ leadId: result.leadId, created: result.isNew });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Duplicate provider message ids (n8n retries) are idempotent no-ops.
    if (/duplicate key|unique/i.test(message)) return NextResponse.json({ duplicate: true });
    logger.error("n8n.webhook_failed", { type: p.type, error: message });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
