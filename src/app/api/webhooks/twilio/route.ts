import { NextResponse, after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { integrationConnections } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { recordChannelReply } from "@/server/services/lead-intake";
import { handleInboundMessage, handleNewLead } from "@/ai/orchestrator";
import { verifyTwilioSignature } from "@/lib/security/api-auth";
import { appUrl, env } from "@/lib/env";
import { normalizePhone } from "@/ai/agents/shared/text-signals";
import { logger } from "@/lib/observability/logger";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = (status = 200) => new NextResponse(EMPTY_TWIML, { status, headers: { "Content-Type": "text/xml" } });

/**
 * Inbound SMS from Twilio. Configure the number's "A message comes in" webhook to
 * {APP_URL}/api/webhooks/twilio. The organization is resolved from the receiving number
 * via integration_connections (provider = 'twilio', config.phoneNumber).
 */
export async function POST(req: Request) {
  const token = env().TWILIO_AUTH_TOKEN;
  if (!token) return twiml(503);
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  const url = `${appUrl()}/api/webhooks/twilio`;
  if (!verifyTwilioSignature(token, req.headers.get("x-twilio-signature"), url, params)) {
    logger.warn("twilio.invalid_signature", {});
    return twiml(403);
  }
  const to = normalizePhone(params.To ?? "");
  const db = await getDb();
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.provider, "twilio"), eq(integrationConnections.status, "connected"), sql`${integrationConnections.config}->>'phoneNumber' = ${to}`))
    .limit(1);
  if (!conn) {
    logger.warn("twilio.unknown_number", {});
    return twiml();
  }
  const ctx = systemContext(db, conn.organizationId, "Twilio");
  try {
    const result = await recordChannelReply(ctx, { from: { phone: params.From }, body: params.Body ?? "", channel: "sms", providerMessageId: params.MessageSid });
    after(() => (result.isNew ? handleNewLead(ctx, result.leadId) : handleInboundMessage(ctx, result.leadId, result.messageId)));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/duplicate key|unique/i.test(message)) logger.error("twilio.inbound_failed", { error: message });
  }
  return twiml();
}
