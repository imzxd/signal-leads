import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  agentEvents,
  agentRuns,
  appointments,
  automationRuns,
  automations,
  consents,
  conversations,
  followUps,
  leadCustomFields,
  leadScores,
  leads,
  messages,
  notifications,
  organizationMembers,
  organizations,
  organizationSettings,
  profiles,
  type Lead,
} from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { DEFAULT_AUTOMATIONS, AUTOMATION_KEYS, type AutomationKey } from "@/server/repositories/automations";
import { createDocument } from "@/server/repositories/knowledge";
import { DEFAULT_FOLLOW_UP_SEQUENCE, DEFAULT_HOURS, getSettings } from "@/server/repositories/settings";
import { getAvailableSlots } from "@/server/repositories/appointments";
import { DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import { formatSlotLabel } from "@/ai/agents/booking/agent";
import { zonedParts, zonedTimeToUtc } from "@/lib/integrations/calendar/dev-provider";
import { temperatureForScore } from "@/features/leads/scoring/engine";
import type { ScoreFactor } from "@/features/leads/scoring/types";
import type { OfferedSlot } from "@/features/leads/lead-state";
import type { AgentType } from "@/types/domain";
import { logger } from "@/lib/observability/logger";
import { DEMO_ESTIMATOR_ID, DEMO_KNOWLEDGE, DEMO_ORG_SLUG, DEMO_OWNER_ID, DEMO_QUALIFICATION_FIELDS, DEMO_SERVICE_AREA, DEMO_SERVICES } from "./demo-config";
import { DEMO_LEADS, type DemoLead, type Step } from "./demo-leads";

const TZ = "America/Toronto";
const MIN = 60_000;
const DAY = 86_400_000;

/** Idempotent: creates the demo organization only if it doesn't exist. */
export async function ensureDemoOrganization(db: Database): Promise<string> {
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, DEMO_ORG_SLUG)).limit(1);
  if (existing) return existing.id;
  logger.info("seed.demo_start", {});
  const id = await seedDemoOrganization(db, { slug: DEMO_ORG_SLUG, ownerUserId: DEMO_OWNER_ID, ownerName: "Alex Morgan", ownerEmail: "alex@evergreenroofing.example" });
  logger.info("seed.demo_done", { organizationId: id });
  return id;
}

export interface SeedOptions {
  slug: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  now?: Date;
}

/** Builds a complete, realistic Evergreen Roofing workspace. Reused by "Create demo workspace" onboarding. */
export async function seedDemoOrganization(db: Database, opts: SeedOptions): Promise<string> {
  const now = opts.now ?? new Date();
  const [org] = await db.insert(organizations).values({ name: "Evergreen Roofing", slug: opts.slug, industry: "Roofing contractor", timezone: TZ, isDemo: true }).returning();
  const ctx = systemContext(db, org.id, "Seed");

  await db
    .insert(profiles)
    .values([
      { id: opts.ownerUserId, email: opts.ownerEmail, fullName: opts.ownerName },
      { id: DEMO_ESTIMATOR_ID, email: "jordan@evergreenroofing.example", fullName: "Jordan Lee" },
    ])
    .onConflictDoNothing();
  await db.insert(organizationMembers).values([
    { organizationId: org.id, userId: opts.ownerUserId, role: "owner" },
    ...(opts.ownerUserId === DEMO_ESTIMATOR_ID ? [] : [{ organizationId: org.id, userId: DEMO_ESTIMATOR_ID, role: "member" as const }]),
  ]);

  await db.insert(organizationSettings).values({
    organizationId: org.id,
    businessName: "Evergreen Roofing",
    phone: "(519) 555-0100",
    email: "hello@evergreenroofing.example",
    website: "https://evergreenroofing.example",
    address: "Guelph, Ontario",
    brandVoice: "Friendly, down-to-earth and reassuring. Plain language, no jargon, no hard selling.",
    averageDealValue: 3500,
    services: DEMO_SERVICES,
    serviceArea: DEMO_SERVICE_AREA,
    qualificationFields: DEMO_QUALIFICATION_FIELDS,
    businessHours: DEFAULT_HOURS,
    messagingHours: { enabled: true, start: "08:00", end: "20:00" },
    followUpSequence: DEFAULT_FOLLOW_UP_SEQUENCE,
    scoringWeights: {},
    escalationRules: { ...DEFAULT_ESCALATION_RULES, keywords: ["insurance adjuster", "property manager", "commercial contract", "lawyer"] },
    bookingConfig: { durationMinutes: 60, slotsToOffer: 3, minLeadTimeHours: 2, appointmentLabel: "Free on-site estimate" },
    formConfig: {
      headline: "Get a free roofing estimate",
      subheadline: "Tell us what's going on with your roof — we reply within minutes, 7 days a week.",
      askCompany: false,
      consentText: "I agree to receive messages from Evergreen Roofing about my request by email or text. Reply STOP to opt out at any time.",
      successMessage: "Thanks! We've got your request and will reply in a few minutes.",
    },
  });

  const autoRows = await db.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a, organizationId: org.id }))).returning();
  const automationId = (key: AutomationKey) => autoRows.find((a) => a.key === key)!.id;

  for (const doc of DEMO_KNOWLEDGE) await createDocument(ctx, doc, opts.ownerUserId);

  // Appointments first, so live booking offers avoid those times.
  const seeded: { lead: Lead; demo: DemoLead }[] = [];
  for (const [i, demo] of DEMO_LEADS.entries()) {
    const lead = await seedLead(db, org.id, demo, i, now, { ownerId: opts.ownerUserId, ownerName: opts.ownerName, automationId });
    seeded.push({ lead, demo });
  }

  // Leads currently choosing a time get real availability from the calendar provider.
  const settings = await getSettings(ctx);
  for (const { lead, demo } of seeded.filter((x) => x.demo.stage === "booking")) {
    const slots = await getAvailableSlots(ctx, settings, { now });
    const offerStep = [...demo.script].reverse().find((s) => s.k === "out:offer");
    await db.update(leads).set({ bookingState: { offeredSlots: slots, offeredAt: new Date(lead.createdAt.getTime() + (offerStep?.m ?? 1) * MIN).toISOString() } }).where(eq(leads.id, lead.id));
    const offerMessage = await db.select().from(messages).where(eq(messages.leadId, lead.id));
    const offer = offerMessage.filter((m) => m.metadata && (m.metadata as Record<string, unknown>).purpose === "booking_offer").pop();
    if (offer) {
      await db.update(messages).set({ body: withSlotList(offer.body, slots, demo.channel) }).where(eq(messages.id, offer.id));
    }
  }

  // One fresh lead is processed live by the orchestrator so the newest activity is real.
  const fresh = seeded.find((x) => x.demo.stage === "new");
  if (fresh) {
    const { handleNewLead } = await import("@/ai/orchestrator");
    await handleNewLead(ctx, fresh.lead.id);
  }
  return org.id;
}

/* ------------------------------------------------------------------------------------ */

interface SeedHelpers {
  ownerId: string;
  ownerName: string;
  automationId: (key: AutomationKey) => string;
}

function pickIndex(text: string): number {
  if (/\b(3|third)\b/i.test(text)) return 2;
  if (/\b(2|second)\b/i.test(text)) return 1;
  return 0;
}

function localTime(daysFromNow: number, hour: number, now: Date): Date {
  const p = zonedParts(new Date(now.getTime() + daysFromNow * DAY), TZ);
  return zonedTimeToUtc(p.year, p.month, p.day, hour, 0, TZ);
}

function withSlotList(body: string, slots: OfferedSlot[], channel: "email" | "sms"): string {
  const list = slots.map((s) => `${s.id}) ${s.label}`).join("\n");
  const block = `\n\nNext available times:\n${list}\n\nReply with ${slots.map((s) => s.id).join(", ").replace(/, (\d)$/, " or $1")} to pick a time.`;
  return channel === "email" ? `${body}${block}\n\n— Evergreen Roofing` : `${body}${block}`;
}

async function seedLead(db: Database, organizationId: string, d: DemoLead, i: number, now: Date, h: SeedHelpers): Promise<Lead> {
  const lastStepMin = Math.max(...d.script.map((s) => s.m));
  let t0 = new Date(now.getTime() - d.daysAgo * DAY - (2 + (i % 6)) * 3600_000 - (i * 7 % 50) * MIN);
  if (t0.getTime() + lastStepMin * MIN > now.getTime() - 10 * MIN) t0 = new Date(now.getTime() - lastStepMin * MIN - 20 * MIN);
  const at = (m: number) => new Date(t0.getTime() + m * MIN);
  const service = DEMO_SERVICES.find((s) => s.key === d.service);
  const assignee = d.assignedToEstimator ? DEMO_ESTIMATOR_ID : ["won", "booked", "hot", "needs_human"].includes(d.stage) ? h.ownerId : null;
  const appointmentAt = d.appointmentDays !== undefined ? localTime(d.appointmentDays, d.appointmentHour ?? 10, now) : null;
  const inbound = d.script.filter((s) => s.k === "in");
  const lastMsg = d.script[d.script.length - 1];

  const qualificationKeys = DEMO_QUALIFICATION_FIELDS.filter((f) => f.required).map((f) => f.key);
  const known: Record<string, string | undefined> = { address: d.address, property_type: d.propertyType, timeline: d.timeline };
  const missing = qualificationKeys.filter((k) => !known[k]);
  const pendingField = ["qualifying", "contacted"].includes(d.stage) ? missing[0] ?? null : null;

  const [lead] = await db
    .insert(leads)
    .values({
      organizationId,
      name: d.name,
      email: d.email ?? null,
      phone: d.phone ?? null,
      company: d.company ?? null,
      source: d.source,
      preferredChannel: d.channel,
      serviceKey: d.service,
      serviceRequested: d.serviceRequested ?? service?.name ?? null,
      intent: d.isSpam ? "spam" : d.service ? `${d.service}_request` : "general_inquiry",
      urgency: d.urgency,
      timeline: d.timeline ?? null,
      budget: d.budget ?? null,
      location: d.location,
      address: d.address ?? null,
      summary: d.summary,
      stage: d.stage,
      score: d.score,
      temperature: temperatureForScore(d.score),
      estimatedValue: service?.averageValue ?? (d.isSpam ? null : 3500),
      wonValue: d.wonValue ?? null,
      controlMode: d.control ?? "autopilot",
      assignedTo: assignee,
      missingFields: d.stage === "new" ? [] : missing,
      qualificationComplete: missing.length === 0,
      nextAction: nextActionFor(d, appointmentAt),
      nextActionAt: appointmentAt && appointmentAt > now ? appointmentAt : null,
      aiConfidence: d.stage === "new" ? null : 0.82 + (i % 5) * 0.03,
      isSpam: Boolean(d.isSpam),
      isExistingCustomer: /last year/i.test(d.script[0].t),
      automationState: { pendingField, askCounts: pendingField ? { [pendingField]: 1 } : {}, consecutiveFallbacks: 0 },
      handoff: d.handoffReason
        ? { required: true, priority: "high", reason: d.handoffReason, ownerSummary: `${d.name}: ${d.summary} Please call personally.`, requestedAt: at(1).toISOString() }
        : null,
      lastContactAt: at(lastMsg.m),
      lastInboundAt: inbound.length ? at(inbound[inbound.length - 1].m) : null,
      lastOutboundAt: d.script.some((s) => s.k.startsWith("out") || s.k === "staff") ? at(Math.max(...d.script.filter((s) => s.k.startsWith("out") || s.k === "staff").map((s) => s.m))) : null,
      firstResponseAt: d.script.find((s) => s.k.startsWith("out")) ? at(d.script.find((s) => s.k.startsWith("out"))!.m) : null,
      recoveredAt: d.recovered ? at(inbound[inbound.length - 1]?.m ?? 0) : null,
      wonAt: d.stage === "won" && appointmentAt ? new Date(appointmentAt.getTime() + 2 * DAY) : null,
      lostAt: d.stage === "lost" ? at(lastStepMin + 60) : null,
      lostReason: d.lostReason ?? null,
      createdAt: t0,
    })
    .returning();

  const customs = [
    d.propertyType ? { key: "property_type", value: d.propertyType } : null,
    d.roofAge ? { key: "roof_age", value: d.roofAge } : null,
    d.service === "emergency_tarp" ? { key: "insurance_claim", value: "yes" } : null,
  ].filter((x): x is { key: string; value: string } => Boolean(x));
  if (customs.length) await db.insert(leadCustomFields).values(customs.map((c) => ({ ...c, organizationId, leadId: lead.id, source: "ai" as const, confidence: 0.9 })));

  if (!d.isSpam) {
    const channels = (["web", d.email ? "email" : null, d.phone ? "sms" : null].filter(Boolean) as ("web" | "email" | "sms")[]);
    await db.insert(consents).values(channels.map((channel) => ({ organizationId, leadId: lead.id, channel, granted: true, source: `${d.source}_checkbox`, evidence: "I agree to receive messages about my request.", createdAt: t0 })));
  }

  const [conversation] = await db
    .insert(conversations)
    .values({
      organizationId,
      leadId: lead.id,
      channel: d.channel === "sms" ? "sms" : "web",
      subject: lead.serviceRequested ?? "New inquiry",
      lastMessageAt: at(lastMsg.m),
      unreadCount: lastMsg.k === "in" && d.stage !== "archived" ? 1 : 0,
      createdAt: t0,
    })
    .returning();

  // ---- timeline -------------------------------------------------------------------
  const events: (typeof agentEvents.$inferInsert)[] = [];
  const runs: (typeof agentRuns.$inferInsert)[] = [];
  const autoRuns: (typeof automationRuns.$inferInsert)[] = [];
  const ev = (m: number, e: Omit<typeof agentEvents.$inferInsert, "organizationId" | "leadId" | "createdAt">) =>
    events.push({ ...e, organizationId, leadId: lead.id, createdAt: new Date(at(m).getTime() + events.length * 1000) });
  const aiRun = (m: number, agent: AgentType, confidence = 0.86) =>
    runs.push({ organizationId, leadId: lead.id, agent, provider: "demo-seed", model: "demo-seed", status: "succeeded", confidence, latencyMs: 300 + ((i * 37 + runs.length * 53) % 900), createdAt: at(m) });
  const autoRun = (m: number, key: AutomationKey, detail: string, status: "succeeded" | "skipped" | "failed" = "succeeded") =>
    autoRuns.push({ organizationId, automationId: h.automationId(key), leadId: lead.id, status, detail, createdAt: at(m) });

  const finalScore = d.score;
  const replies = inbound.length - 1;
  let currentScore = d.isSpam ? finalScore : Math.max(8, finalScore - replies * 14 - (d.stage === "new" ? finalScore : 0));
  const firstFactors: ScoreFactor[] = [
    service ? { key: "service_supported", label: "Requested service is offered", points: 15, kind: "positive" } : null,
    d.location && DEMO_SERVICE_AREA.cities.includes(d.location) ? { key: "in_area", label: "Inside the service area", points: 15, kind: "positive" } : null,
    d.location && !DEMO_SERVICE_AREA.cities.includes(d.location) ? { key: "outside_area", label: "Outside the service area", points: -30, kind: "negative" } : null,
    d.urgency === "emergency" || d.urgency === "urgent" ? { key: `urgency_${d.urgency}`, label: d.urgency === "emergency" ? "Emergency — needs help now" : "Urgent requirement", points: d.urgency === "emergency" ? 15 : 12, kind: "positive" } : null,
  ].filter((x): x is ScoreFactor => Boolean(x));

  const scoreRows: (typeof leadScores.$inferInsert)[] = [];
  let lastOffered: OfferedSlot[] = [];
  let inboundSeen = 0;
  let lastWasFollowUp = 0;
  const fuRows: (typeof followUps.$inferInsert)[] = [];
  let anchorStep: Step | null = null;

  const messageRows: (typeof messages.$inferInsert)[] = [];
  for (const step of d.script) {
    const when = at(step.m);
    if (step.k === "in") {
      inboundSeen++;
      messageRows.push({ organizationId, conversationId: conversation.id, leadId: lead.id, direction: "inbound", authorType: "lead", channel: inboundSeen === 1 ? "web" : d.channel, body: step.t, status: "received", createdAt: when });
      if (inboundSeen === 1) {
        ev(step.m, { type: "lead_received", actor: "lead", actorLabel: d.name, title: `Lead received via ${d.source === "form" ? "lead form" : d.source === "embed" ? "website embed" : d.source === "api" ? "API" : d.source === "sms" ? "SMS" : d.source === "email" ? "email" : "webhook"}`, detail: step.t, receipt: d.isSpam ? null : { headline: "Consent captured for automated replies", reasons: ["Consent: web", ...(d.email ? ["Consent: email"] : []), ...(d.phone ? ["Consent: sms"] : [])] } });
        if (d.stage === "new") continue;
        aiRun(step.m + 0.05, "intake");
        ev(step.m + 0.05, {
          type: "intake_completed",
          actor: "agent",
          actorLabel: "Intake Agent",
          title: d.isSpam ? "Intake Agent flagged a likely spam message" : `Intake Agent identified “${lead.serviceRequested ?? "General inquiry"}”`,
          detail: d.summary,
          receipt: { headline: d.summary, reasons: [d.urgency !== "unknown" ? `Urgency: ${d.urgency}` : "", d.location ? `Location: ${d.location}` : "", d.timeline ? `Timeline: ${d.timeline}` : ""].filter(Boolean), confidence: 0.9 },
        });
        if (d.isSpam) {
          aiRun(step.m + 0.1, "scoring", 0.95);
          ev(step.m + 0.1, { type: "score_changed", actor: "agent", actorLabel: "Scoring Agent", title: `Lead scored ${finalScore} — Cold`, receipt: { headline: "Likely spam or a fake inquiry — automation will not pursue it.", reasons: ["Looks like spam or a fake inquiry"] } });
          ev(step.m + 0.12, { type: "stage_changed", actor: "agent", actorLabel: "Signal", title: "Archived as spam — no reply sent", receipt: { headline: "Not a real inquiry", reasons: ["Spam or vendor pitch patterns", "No buying intent"], nextAction: "None" } });
          scoreRows.push({ organizationId, leadId: lead.id, score: finalScore, temperature: "cold", factors: [{ key: "spam", label: "Looks like spam or a fake inquiry", points: -40, kind: "negative" }], explanation: "Likely spam or a fake inquiry — automation will not pursue it.", recommendedAction: "Ignored — spam", createdAt: at(step.m + 0.1) });
          continue;
        }
        const inArea = d.location && DEMO_SERVICE_AREA.cities.includes(d.location);
        ev(step.m + 0.08, {
          type: "validation",
          actor: "system",
          actorLabel: "Business rules",
          title: inArea ? "Service-area validation passed" : d.location ? "Business-rule check flagged this lead" : "Business rules checked",
          receipt: { headline: inArea ? "Within business rules" : d.location ? "Outside business rules" : "Within business rules", reasons: [service ? "Requested service is offered" : "Service not identified yet", inArea ? `${d.location} is inside the service area` : d.location ? `${d.location} is outside the service area` : "Location not known yet"] },
        });
        aiRun(step.m + 0.1, "scoring");
        scoreRows.push({ organizationId, leadId: lead.id, score: currentScore, temperature: temperatureForScore(currentScore), factors: firstFactors, explanation: "Initial score from the first message.", recommendedAction: "Ask the next question", createdAt: at(step.m + 0.1) });
        ev(step.m + 0.1, { type: "score_changed", actor: "agent", actorLabel: "Scoring Agent", title: `Lead scored ${currentScore} — ${cap(temperatureForScore(currentScore))}`, receipt: { headline: "Initial score", reasons: firstFactors.filter((f) => f.kind === "positive").map((f) => f.label), confidence: 0.84 } });
      } else {
        ev(step.m, { type: "reply_received", actor: "lead", actorLabel: d.name, title: "Lead responded", detail: step.t });
        const pendingFus = fuRows.filter((f) => f.status === "scheduled");
        // Follow-ups still queued at the time of this reply are cancelled.
        if (anchorStep) {
          const sentSeqs = fuRows.filter((f) => f.status === "sent").map((f) => f.sequenceNumber);
          const remaining = DEFAULT_FOLLOW_UP_SEQUENCE.map((_, idx) => idx + 1).filter((seq) => !sentSeqs.includes(seq));
          for (const seq of remaining) {
            fuRows.push({ organizationId, leadId: lead.id, conversationId: conversation.id, channel: d.channel, scheduledFor: new Date(at(anchorStep.m).getTime() + DEFAULT_FOLLOW_UP_SEQUENCE[seq - 1].delayHours * 3600_000), status: "cancelled", sequenceNumber: seq, strategy: DEFAULT_FOLLOW_UP_SEQUENCE[seq - 1].strategy, idempotencyKey: `seed:${lead.id}:${anchorStep.m}:${seq}`, cancelReason: "lead_responded", cancelledAt: when, createdAt: at(anchorStep.m) });
          }
          if (remaining.length) ev(step.m + 0.02, { type: "follow_up_cancelled", actor: "system", actorLabel: "Follow-Up Agent", title: `Cancelled ${remaining.length} pending follow-up${remaining.length === 1 ? "" : "s"} — lead replied` });
          anchorStep = null;
        }
        void pendingFus;
        if (lastWasFollowUp && d.recovered) {
          ev(step.m + 0.03, { type: "lead_recovered", actor: "system", actorLabel: "Signal", title: `Lead recovered by follow-up ${lastWasFollowUp}`, receipt: { headline: "Went quiet, then re-engaged after an automated follow-up", reasons: [`Follow-up ${lastWasFollowUp} preceded this reply`], nextAction: "Continue qualification" } });
        }
        lastWasFollowUp = 0;
        const isPick = lastOffered.length > 0;
        aiRun(step.m + 0.05, "reply_parser");
        if (isPick) {
          const slot = lastOffered[pickIndex(step.t)] ?? lastOffered[0];
          ev(step.m + 0.06, { type: "booking_offered", actor: "agent", actorLabel: "Booking Agent", title: `Lead selected ${slot.label}` });
          ev(step.m + 0.07, { type: "appointment_created", actor: "agent", actorLabel: "Booking Agent", title: `Appointment created — ${slot.label}`, receipt: { headline: "Booked on the calendar", reasons: ["Free on-site estimate", "60 minutes", d.address ?? d.location ?? ""], nextAction: "Confirm with the customer and notify the owner" } });
          lastOffered = [];
          continue;
        }
        const next = Math.min(finalScore, currentScore + Math.max(6, Math.round((finalScore - currentScore) / Math.max(1, replies - inboundSeen + 2))));
        if (next !== currentScore) {
          aiRun(step.m + 0.08, "scoring");
          const gained = [d.address ? "Inside the service area" : null, "Responsive prospect", "More required details provided"].filter(Boolean) as string[];
          scoreRows.push({ organizationId, leadId: lead.id, score: next, previousScore: currentScore, temperature: temperatureForScore(next), factors: [...firstFactors, { key: "responsive", label: "Responsive prospect", points: 6, kind: "positive" }], explanation: "Responsive prospect with more details provided.", recommendedAction: next >= 60 ? "Offer appointment" : "Ask the next question", createdAt: at(step.m + 0.08) });
          ev(step.m + 0.08, { type: "score_changed", actor: "agent", actorLabel: "Scoring Agent", title: `Lead score increased from ${currentScore} → ${next}`, receipt: { headline: `Score +${next - currentScore}`, scoreDelta: next - currentScore, reasons: gained, nextAction: next >= 60 ? "Offer appointment" : "Ask the next question", confidence: 0.86 } });
          currentScore = next;
        }
      }
      continue;
    }

    if (step.k === "note") {
      messageRows.push({ organizationId, conversationId: conversation.id, leadId: lead.id, direction: "internal", authorType: "staff", authorId: DEMO_ESTIMATOR_ID, channel: "internal", body: step.t, status: "sent", createdAt: when });
      ev(step.m, { type: "note", actor: "staff", actorLabel: "Jordan Lee", title: "Internal note", detail: step.t });
      continue;
    }
    if (step.k === "staff") {
      messageRows.push({ organizationId, conversationId: conversation.id, leadId: lead.id, direction: "outbound", authorType: "staff", authorId: h.ownerId, channel: d.channel, body: step.t, status: "simulated", provider: "dev-simulator", createdAt: when, sentAt: when });
      ev(step.m, { type: "message_sent", actor: "staff", actorLabel: h.ownerName, title: `${h.ownerName} sent a message`, detail: step.t });
      continue;
    }

    // Automated outbound
    let body = step.t;
    let purpose = "reply";
    const fuMatch = step.k.match(/^out:fu(\d)$/);
    if (step.k === "out:offer") {
      purpose = "booking_offer";
      const picked = d.script.slice(d.script.indexOf(step) + 1).find((s) => s.k === "in");
      const base = appointmentAt ?? localTime(1, 10, now);
      const idx = picked ? pickIndex(picked.t) : 0;
      const times = [0, 1, 2].map((n) => new Date(base.getTime() + (n - idx) * (DAY + 2 * 3600_000)));
      lastOffered = times.map((t, n) => ({ id: String(n + 1), startsAt: t.toISOString(), endsAt: new Date(t.getTime() + 3600_000).toISOString(), label: formatSlotLabel(t, TZ) }));
      if (d.stage !== "booking") body = withSlotList(body, lastOffered, d.channel);
      aiRun(step.m, "booking");
      ev(step.m - 0.01, { type: "booking_offered", actor: "agent", actorLabel: "Booking Agent", title: `Offered ${lastOffered.map((x) => x.label).join(", ")}`, receipt: { headline: "Times come from the calendar provider", reasons: lastOffered.map((x) => `${x.id}) ${x.label}`), nextAction: "Book the time the customer picks" } });
      autoRun(step.m, AUTOMATION_KEYS.bookingOffer, "3 times offered");
    } else if (step.k === "out:confirm") {
      purpose = "booking_confirmation";
      if (appointmentAt) body = body.replace(/\.$/, ".") + `\n\nAppointment: ${formatSlotLabel(appointmentAt, TZ)}${d.channel === "email" ? "\n\n— Evergreen Roofing" : ""}`;
      autoRun(step.m, AUTOMATION_KEYS.appointmentConfirmation, appointmentAt ? formatSlotLabel(appointmentAt, TZ) : "Confirmed");
    } else if (step.k === "out:hold") {
      purpose = "handoff_holding";
      aiRun(step.m - 0.02, "handoff", 0.9);
      ev(step.m + 0.02, { type: "handoff_requested", actor: "agent", actorLabel: "Handoff Agent", title: `Handed off to the team — ${d.handoffReason ?? "Customer asked for a person"}`, receipt: { headline: "High priority", reasons: [d.handoffReason ?? "Customer asked for a person", d.summary], nextAction: "Automation paused until a team member returns control" } });
      autoRun(step.m, AUTOMATION_KEYS.humanEscalation, d.handoffReason ?? "Customer asked for a person");
    } else if (step.k === "out:close") {
      purpose = "closing";
    } else if (fuMatch) {
      purpose = "follow_up";
    } else if (step.k === "out:first" || step.k === "out:ask") {
      purpose = step.k === "out:first" ? "first_response" : "reply";
      const asked = /address/i.test(body) ? "address" : /house, townhome/i.test(body) ? "property type" : /how old/i.test(body) ? "approximate roof age" : /when are you hoping/i.test(body) ? "timeline" : null;
      if (asked) {
        aiRun(step.m - 0.03, "qualification");
        ev(step.m - 0.03, { type: "qualification", actor: "agent", actorLabel: "Qualification Agent", title: `Qualification Agent requested ${asked}`, receipt: { headline: "Required details still needed", reasons: [`Asking for: ${asked}`], nextAction: "Wait for the customer's answer" } });
      }
      autoRun(step.m, AUTOMATION_KEYS.newLead, `Sent via ${d.channel}`);
    }
    aiRun(step.m, fuMatch ? "follow_up" : "drafting", 0.8);
    messageRows.push({
      organizationId,
      conversationId: conversation.id,
      leadId: lead.id,
      direction: "outbound",
      authorType: "ai",
      channel: d.channel,
      body,
      status: "simulated",
      provider: "dev-simulator",
      idempotencyKey: `seed:${lead.id}:${step.m}`,
      metadata: { purpose },
      createdAt: when,
      sentAt: when,
    });
    if (fuMatch) {
      const seq = Number(fuMatch[1]);
      lastWasFollowUp = seq;
      fuRows.push({ organizationId, leadId: lead.id, conversationId: conversation.id, channel: d.channel, scheduledFor: when, status: "sent", sequenceNumber: seq, strategy: DEFAULT_FOLLOW_UP_SEQUENCE[seq - 1].strategy, idempotencyKey: `seed:${lead.id}:fu:${seq}`, attempts: 1, executedAt: when, createdAt: anchorStep ? at(anchorStep.m) : when });
      ev(step.m, { type: "follow_up_sent", actor: "agent", actorLabel: "Follow-Up Agent", title: `Follow-up ${seq} sent`, detail: body, receipt: { headline: `Follow-up ${seq} of 3`, reasons: ["No reply since our last message", "Consent on file", "Autopilot on"], nextAction: seq < 3 ? "Next follow-up in sequence" : "Stop sequence" } });
      autoRun(step.m, seq === 1 ? AUTOMATION_KEYS.followUp1 : seq === 2 ? AUTOMATION_KEYS.followUp2 : AUTOMATION_KEYS.followUp3, `Sent via ${d.channel}`);
    } else {
      const title =
        step.k === "out:first" ? "First response sent" : step.k === "out:offer" ? "Booking Agent offered 3 appointment times" : step.k === "out:confirm" ? "Confirmation sent to the customer" : step.k === "out:hold" ? "Let the customer know a person will follow up" : step.k === "out:close" ? "Sent a polite closing message" : "Replied and asked the next question";
      ev(step.m, { type: "message_sent", actor: "agent", actorLabel: "Signal", title, detail: body });
      if (step.k === "out:confirm") ev(step.m + 0.01, { type: "owner_notified", actor: "system", actorLabel: "Signal", title: "Owner notified of the new appointment" });
      if (["out:first", "out:ask", "out:offer"].includes(step.k)) {
        anchorStep = step;
        ev(step.m + 0.01, { type: "follow_up_scheduled", actor: "agent", actorLabel: "Follow-Up Agent", title: "Follow-ups scheduled (+1d, +3d, +7d) if no reply", receipt: { headline: "Sequence stops the moment they reply", reasons: ["Lead hasn't replied yet", "Consent on file", "Autopilot on"] } });
      } else {
        anchorStep = null;
      }
    }
  }

  // Pending follow-ups for leads still waiting on a reply.
  if (d.pendingFollowUps && anchorStep) {
    const sentSeqs = fuRows.filter((f) => f.status === "sent").map((f) => f.sequenceNumber);
    const next = DEFAULT_FOLLOW_UP_SEQUENCE.map((_, idx) => idx + 1).filter((seq) => !sentSeqs.includes(seq)).slice(0, d.pendingFollowUps);
    for (const seq of next) {
      let due = new Date(at(anchorStep.m).getTime() + DEFAULT_FOLLOW_UP_SEQUENCE[seq - 1].delayHours * 3600_000);
      if (due <= now) due = new Date(now.getTime() + (2 + seq) * 3600_000);
      fuRows.push({ organizationId, leadId: lead.id, conversationId: conversation.id, channel: d.channel, scheduledFor: due, status: "scheduled", sequenceNumber: seq, strategy: DEFAULT_FOLLOW_UP_SEQUENCE[seq - 1].strategy, idempotencyKey: `seed:${lead.id}:pending:${seq}`, createdAt: at(anchorStep.m) });
    }
  }

  // Final score row matches the lead's current score.
  if (!d.isSpam && d.stage !== "new" && currentScore !== finalScore) {
    scoreRows.push({ organizationId, leadId: lead.id, score: finalScore, previousScore: currentScore, temperature: temperatureForScore(finalScore), factors: firstFactors, explanation: "Updated after the latest activity.", recommendedAction: nextActionFor(d, appointmentAt), createdAt: at(lastStepMin + 0.2) });
    ev(lastStepMin + 0.2, { type: "score_changed", actor: "agent", actorLabel: "Scoring Agent", title: `Lead score ${finalScore > currentScore ? "increased" : "decreased"} from ${currentScore} → ${finalScore}`, receipt: { headline: `Score ${finalScore > currentScore ? "+" : ""}${finalScore - currentScore}`, scoreDelta: finalScore - currentScore, reasons: finalScore > currentScore ? ["All required details provided", "Clear buying intent"] : ["No reply after follow-ups"], confidence: 0.85 } });
  }
  if (finalScore >= 80 && d.stage !== "new") {
    ev(lastStepMin + 0.25, { type: "owner_notified", actor: "system", actorLabel: "Hot Lead Alert", title: "Owner notified — hot lead" });
    autoRun(lastStepMin + 0.25, AUTOMATION_KEYS.hotLeadAlert, `Score ${finalScore}`);
  }
  if (d.control === "human") {
    ev(30, { type: "takeover", actor: "staff", actorLabel: "Jordan Lee", title: "Jordan Lee took over — AI messaging stopped" });
  }
  if (d.stage === "won" && d.wonValue) {
    const wonAt = appointmentAt ? new Date(appointmentAt.getTime() + 2 * DAY) : at(lastStepMin + 600);
    ev((wonAt.getTime() - t0.getTime()) / MIN, { type: "converted", actor: "staff", actorLabel: h.ownerName, title: `Marked won — $${d.wonValue.toLocaleString()}`, receipt: { headline: "Conversion recorded", reasons: ["All follow-ups stopped", d.recovered ? "Recovered by follow-up earlier" : "Converted from active pipeline"] } });
  }
  if (d.stage === "lost") {
    ev(lastStepMin + 60, { type: "lost", actor: d.lostReason === "Customer not interested" ? "agent" : "staff", actorLabel: h.ownerName, title: `Marked lost — ${d.lostReason}` });
  }

  if (messageRows.length) await db.insert(messages).values(messageRows);
  if (runs.length) {
    const insertedRuns = await db.insert(agentRuns).values(runs).returning({ id: agentRuns.id });
    void insertedRuns;
  }
  if (events.length) await db.insert(agentEvents).values(events);
  if (scoreRows.length) await db.insert(leadScores).values(scoreRows);
  if (fuRows.length) await db.insert(followUps).values(fuRows);
  if (autoRuns.length) await db.insert(automationRuns).values(autoRuns);

  if (appointmentAt) {
    await db.insert(appointments).values({
      organizationId,
      leadId: lead.id,
      title: `Free on-site estimate — ${d.name}`,
      startsAt: appointmentAt,
      endsAt: new Date(appointmentAt.getTime() + 3600_000),
      status: appointmentAt < now ? "completed" : "confirmed",
      provider: "dev-calendar",
      externalId: `dev_seed_${i}`,
      location: d.address ? `${d.address}, ${d.location}` : d.location,
      createdBy: "agent",
      createdAt: t0,
    });
  }

  // Notifications for the bell.
  const notes: (typeof notifications.$inferInsert)[] = [];
  if (d.stage === "needs_human") notes.push({ organizationId, leadId: lead.id, type: "handoff", priority: "high", title: `Needs you: ${d.name} — ${d.handoffReason}`, body: d.summary, createdAt: at(1) });
  if (d.stage === "booked" && appointmentAt) notes.push({ organizationId, leadId: lead.id, type: "appointment", priority: "high", title: `Booked: ${d.name} — ${formatSlotLabel(appointmentAt, TZ)}`, body: d.summary, createdAt: at(lastStepMin), readAt: d.daysAgo > 3 ? now : null });
  if (finalScore >= 80 && ["hot", "booking"].includes(d.stage)) notes.push({ organizationId, leadId: lead.id, type: "hot_lead", priority: "urgent", title: `Hot lead: ${d.name} (${finalScore})`, body: d.summary, createdAt: at(lastStepMin) });
  if (notes.length) await db.insert(notifications).values(notes);

  return lead;
}

function nextActionFor(d: DemoLead, appointmentAt: Date | null): string {
  switch (d.stage) {
    case "won":
      return "Won — automation stopped";
    case "lost":
      return "Lost — automation stopped";
    case "booked":
      return appointmentAt ? `Appointment ${formatSlotLabel(appointmentAt, TZ)}` : "Appointment booked";
    case "booking":
      return "Waiting for the customer to pick a time";
    case "hot":
      return d.control === "human" ? "Team member is handling this lead" : "Offer appointment";
    case "qualified":
      return "Nurture — follow up";
    case "qualifying":
    case "contacted":
      return "Waiting on: address";
    case "needs_human":
      return "Reply personally";
    case "archived":
      return "Ignored — spam";
    default:
      return "Signal is processing";
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
