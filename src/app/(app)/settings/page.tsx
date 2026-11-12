import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { requireOrgContext } from "@/lib/auth/session";
import { apiKeys } from "@/server/db/schema";
import { getSettings } from "@/server/repositories/settings";
import { describeAIMode, getEmbeddingProvider } from "@/ai/providers";
import { appUrl, features } from "@/lib/env";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsClient } from "@/components/settings/settings-client";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const { session, ctx } = await requireOrgContext();
  const s = await getSettings(ctx);
  const keys = await ctx.db.select().from(apiKeys).where(eq(apiKeys.organizationId, ctx.organizationId)).orderBy(desc(apiKeys.createdAt));
  const ai = describeAIMode();
  const embedder = getEmbeddingProvider();

  const integrations = [
    { name: "AI agents", status: ai.live ? "live" : "dev", detail: ai.live ? "Anthropic Claude (Haiku for extraction, Sonnet for writing) with deterministic fallbacks." : ai.detail },
    { name: "Embeddings (knowledge search)", status: embedder.live ? "live" : "dev", detail: embedder.live ? `Voyage ${embedder.model}` : "Local hashing embedder — set VOYAGE_API_KEY for semantic retrieval." },
    { name: "Email (Resend)", status: features.resend() ? "live" : "dev", detail: features.resend() ? "Outbound email via Resend." : "Emails are simulated. Set RESEND_API_KEY and RESEND_FROM_EMAIL." },
    { name: "SMS (Twilio)", status: features.twilio() ? "live" : "dev", detail: features.twilio() ? "Outbound and inbound SMS via Twilio." : "Texts are simulated. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER." },
    { name: "n8n", status: features.n8n() ? "live" : "off", detail: features.n8n() ? "Signed webhooks enabled at /api/webhooks/n8n." : "Set N8N_WEBHOOK_SECRET (and N8N_OUTBOUND_WEBHOOK_URL for event fan-out)." },
    { name: "Calendar", status: "dev", detail: "Development calendar from your business hours. Google Calendar, Outlook and Calendly adapters plug into CalendarProvider." },
  ] as const;

  return (
    <div>
      <PageHeader eyebrow="Settings" title={welcome ? "Welcome — let's set up Signal" : "Settings"} description={welcome ? "Add your services, service area and qualification questions. Then share your lead form." : `${session.organization.name} · ${session.role}`} />
      {session.organization.isDemo && <p className="mb-4 text-xs text-foreground-subtle">Demo workspace: messages, texts and calendar events are simulated, even if credentials are configured.</p>}
      <SettingsClient
        canEdit={session.role !== "member"}
        formUrl={`${appUrl()}/forms/${session.organization.slug}`}
        integrations={integrations.map((i) => ({ ...i }))}
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revoked: Boolean(k.revokedAt) }))}
        data={{
          company: { businessName: s.businessName, phone: s.phone, email: s.email, website: s.website, address: s.address, brandVoice: s.brandVoice, averageDealValue: s.averageDealValue, timezone: s.organization.timezone },
          services: s.services,
          serviceArea: s.serviceArea,
          qualification: s.qualificationFields,
          followUps: { sequence: s.followUpSequence, messagingHours: s.messagingHours },
          escalation: s.escalationRules,
          booking: s.booking,
          form: s.form,
        }}
      />
    </div>
  );
}
