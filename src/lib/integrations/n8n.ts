import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

/**
 * n8n is the integration layer *around* Signal Leads: it receives signed events
 * (to fan out SMS/Slack alerts, CRM sync, etc.) and calls signed webhooks back.
 * Core domain logic stays in this codebase.
 */
export type OutboundEventType =
  | "lead.created"
  | "lead.hot"
  | "lead.handoff_requested"
  | "lead.won"
  | "lead.lost"
  | "appointment.created"
  | "notification.created";

export function signPayload(body: string, secret: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Verify `x-signal-signature` = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)) with a 5-minute window. */
export function verifySignature(rawBody: string, signature: string | null, timestamp: string | null, secret: string, now = Date.now()): boolean {
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60_000) return false;
  const expected = Buffer.from(signPayload(rawBody, secret, timestamp), "hex");
  const given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function emitOutboundEvent(type: OutboundEventType, organizationId: string, data: Record<string, unknown>): Promise<void> {
  const url = env().N8N_OUTBOUND_WEBHOOK_URL;
  const secret = env().N8N_WEBHOOK_SECRET;
  if (!url || !secret) return; // integration not configured — nothing to do
  const body = JSON.stringify({ type, organizationId, data, sentAt: new Date().toISOString() });
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signal-timestamp": timestamp, "x-signal-signature": signPayload(body, secret, timestamp) },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) logger.warn("n8n.event_rejected", { type, status: res.status });
  } catch (e) {
    logger.warn("n8n.event_failed", { type, error: e instanceof Error ? e.message : String(e) });
  }
}
