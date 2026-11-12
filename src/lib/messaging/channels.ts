import { randomUUID } from "node:crypto";
import { env, features } from "@/lib/env";
import type { ContactChannel } from "@/types/domain";

export interface ChannelSendInput {
  to: string;
  body: string;
  subject?: string;
  idempotencyKey: string;
  fromName: string;
  replyTo?: string | null;
}

export interface ChannelSendResult {
  status: "sent" | "simulated";
  provider: string;
  providerMessageId: string;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly isDevelopment: boolean;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}

/**
 * DEVELOPMENT CHANNEL — records the message as delivered without sending anything.
 * Shown in the UI as "Simulated" so nobody mistakes it for a real delivery.
 */
export class SimulatedChannel implements ChannelAdapter {
  readonly id = "dev-simulator";
  readonly isDevelopment = true;
  async send(): Promise<ChannelSendResult> {
    return { status: "simulated", provider: this.id, providerMessageId: `sim_${randomUUID()}` };
  }
}

/** Resend email adapter (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailChannel implements ChannelAdapter {
  readonly id = "resend";
  readonly isDevelopment = false;
  constructor(private apiKey: string, private fromEmail: string) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: `${input.fromName} <${this.fromEmail}>`,
        to: [input.to],
        subject: input.subject ?? `Your request with ${input.fromName}`,
        text: `${input.body}\n\n—\nReply "unsubscribe" to stop receiving these messages.`,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    const json = (await res.json()) as { id: string };
    return { status: "sent", provider: this.id, providerMessageId: json.id };
  }
}

/** Twilio SMS adapter (Messages resource). Twilio handles carrier-level STOP keywords. */
export class TwilioSmsChannel implements ChannelAdapter {
  readonly id = "twilio";
  readonly isDevelopment = false;
  constructor(private sid: string, private token: string, private from: string) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const body = new URLSearchParams({ To: input.to, From: this.from, Body: input.body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Twilio rejected the SMS (HTTP ${res.status})`);
    const json = (await res.json()) as { sid: string };
    return { status: "sent", provider: this.id, providerMessageId: json.sid };
  }
}

const simulated = new SimulatedChannel();

/** Demo organizations never reach real inboxes or phones, even if credentials are configured. */
export function getChannelAdapter(channel: ContactChannel, opts: { isDemoOrg: boolean }): ChannelAdapter {
  if (opts.isDemoOrg) return simulated;
  if (channel === "email" && features.resend()) return new ResendEmailChannel(env().RESEND_API_KEY!, env().RESEND_FROM_EMAIL!);
  if (channel === "sms" && features.twilio()) return new TwilioSmsChannel(env().TWILIO_ACCOUNT_SID!, env().TWILIO_AUTH_TOKEN!, env().TWILIO_PHONE_NUMBER!);
  return simulated;
}
