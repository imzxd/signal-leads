import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentEvents, appointments, followUps, messages } from "@/server/db/schema";
import type { DatabaseHandle } from "@/server/db/client";
import { createInboundLead } from "@/server/services/lead-intake";
import { getLead } from "@/server/repositories/leads";
import { getPrimaryConversation, recordInboundMessage } from "@/server/repositories/conversations";
import { handleInboundMessage, handleNewLead } from "@/ai/orchestrator";
import { processDueFollowUps } from "@/server/jobs/follow-ups";
import { markWon, sendStaffMessage, takeOver, returnToSignal } from "@/server/services/lead-actions";
import { sendMessage } from "@/lib/messaging/outbound";
import { getMetrics } from "@/server/repositories/analytics";
import type { OrgContext } from "@/server/context";
import { createOrg, createTestDatabase, staffCtx, systemCtx } from "../helpers/db";

let h: DatabaseHandle;
let ctx: OrgContext;
let staff: OrgContext;
const OWNER = "10000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  h = await createTestDatabase();
  const org = await createOrg(h, { slug: "acme-roofing", ownerId: OWNER });
  ctx = systemCtx(h, org.id);
  staff = staffCtx(h, org.id, OWNER);
});
afterAll(async () => h.close());

async function newLead(message: string, extra: Partial<Parameters<typeof createInboundLead>[1]> = {}) {
  const r = await createInboundLead(ctx, { name: "Sam Rivera", email: `sam${Math.random().toString(36).slice(2, 7)}@example.com`, message, preferredChannel: "email", consent: true, ...extra } as never, { source: "form" });
  const wf = await handleNewLead(ctx, r.leadId);
  expect(wf.ok).toBe(true);
  return r.leadId;
}

async function reply(leadId: string, body: string) {
  const lead = await getLead(ctx, leadId);
  const conv = await getPrimaryConversation(ctx, lead);
  const msg = await recordInboundMessage(ctx, { lead, conversation: conv, body, channel: "email" });
  const wf = await handleInboundMessage(ctx, leadId, msg.id);
  expect(wf.ok).toBe(true);
  return getLead(ctx, leadId);
}

const outbound = (leadId: string) => h.db.select().from(messages).where(and(eq(messages.leadId, leadId), eq(messages.direction, "outbound")));
const fus = (leadId: string) => h.db.select().from(followUps).where(eq(followUps.leadId, leadId));
const eventTypes = async (leadId: string) => (await h.db.select().from(agentEvents).where(eq(agentEvents.leadId, leadId))).map((e) => e.type);

describe("NEW_LEAD → LEAD_REPLY → booking → conversion (MVP success path)", () => {
  let leadId: string;

  it("processes a new lead: intake, validation, scoring, one question, follow-ups scheduled", async () => {
    leadId = await newLead("Our roof is leaking over the kitchen. We're in Guelph and need it fixed this week.");
    const lead = await getLead(ctx, leadId);
    expect(lead.serviceKey).toBe("roof_repair");
    expect(lead.urgency).toBe("urgent");
    expect(lead.location).toBe("Guelph");
    expect(lead.stage).toBe("qualifying");
    expect(lead.score).toBeGreaterThan(0);
    expect(lead.automationState.pendingField).toBe("address");

    const out = await outbound(leadId);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("simulated");
    expect(out[0].body).toMatch(/address/i);

    const scheduled = (await fus(leadId)).filter((f) => f.status === "scheduled");
    expect(scheduled.map((f) => f.sequenceNumber)).toEqual([1, 2, 3]);

    const types = await eventTypes(leadId);
    expect(types).toEqual(expect.arrayContaining(["lead_received", "intake_completed", "validation", "score_changed", "qualification", "message_sent", "follow_up_scheduled"]));
  });

  it("re-running the workflow is idempotent (no duplicate first response)", async () => {
    await handleNewLead(ctx, leadId);
    expect((await outbound(leadId)).filter((m) => m.status !== "blocked")).toHaveLength(1);
  });

  it("a reply cancels pending follow-ups, updates the lead, rescores and offers real times", async () => {
    const before = await getLead(ctx, leadId);
    const lead = await reply(leadId, "It's 42 Maple Ave, a detached house");
    expect(lead.address).toMatch(/42 Maple Ave/);
    const statuses = (await fus(leadId)).filter((f) => f.sequenceNumber <= 3 && f.idempotencyKey.includes(":") && f.cancelReason === "lead_responded");
    expect(statuses.length).toBe(3);
    expect(lead.score).toBeGreaterThan(before.score);
    expect(lead.stage).toBe("booking");
    expect(lead.bookingState.offeredSlots?.length).toBe(3);
    const offer = (await outbound(leadId)).at(-1)!;
    expect(offer.body).toContain(lead.bookingState.offeredSlots![1].label);
    const types = await eventTypes(leadId);
    expect(types).toEqual(expect.arrayContaining(["reply_received", "follow_up_cancelled", "booking_offered"]));
    const scoreEvent = (await h.db.select().from(agentEvents).where(and(eq(agentEvents.leadId, leadId), eq(agentEvents.type, "score_changed")))).at(-1)!;
    expect(scoreEvent.receipt?.scoreDelta).toBeGreaterThan(0);
  });

  it("customer picks a time → appointment created, confirmation sent, follow-ups stopped", async () => {
    const lead = await reply(leadId, "2 works for me");
    expect(lead.stage).toBe("booked");
    const appts = await h.db.select().from(appointments).where(eq(appointments.leadId, leadId));
    expect(appts).toHaveLength(1);
    expect(appts[0].status).toBe("confirmed");
    expect((await outbound(leadId)).at(-1)!.body).toMatch(/Appointment:/);
    expect((await fus(leadId)).some((f) => f.status === "scheduled")).toBe(false);
  });

  it("marking won stops automation and shows up in analytics", async () => {
    await markWon(staff, leadId, 1450);
    const lead = await getLead(ctx, leadId);
    expect(lead.stage).toBe("won");
    const m = await getMetrics(ctx, 30);
    expect(m.wins).toBeGreaterThanOrEqual(1);
    expect(m.wonRevenue).toBeGreaterThanOrEqual(1450);
    expect(m.bookings).toBeGreaterThanOrEqual(1);
  });
});

describe("follow-up engine", () => {
  it("sends a due follow-up exactly once, even if the worker runs twice or concurrently", async () => {
    const leadId = await newLead("Need a roof inspection in Kitchener, no rush.");
    const future = new Date(Date.now() + 25 * 3600_000);
    const [a, b] = await Promise.all([processDueFollowUps(h.db, { now: future, organizationId: ctx.organizationId }), processDueFollowUps(h.db, { now: future, organizationId: ctx.organizationId })]);
    expect(a.sent + b.sent).toBe(1);
    await processDueFollowUps(h.db, { now: future, organizationId: ctx.organizationId });
    const sent = (await fus(leadId)).filter((f) => f.status === "sent");
    expect(sent).toHaveLength(1);
    const fuMessages = (await outbound(leadId)).filter((m) => (m.metadata as { followUpId?: string }).followUpId);
    expect(fuMessages).toHaveLength(1);
  });

  it("recovers from a crashed worker without double-sending", async () => {
    const leadId = await newLead("Gutters overflowing in Waterloo, would like a quote.");
    const [fu1] = (await fus(leadId)).filter((f) => f.sequenceNumber === 1);
    const t = new Date(Date.now() + 25 * 3600_000);
    // Simulate a worker that claimed the row and crashed after the message was sent.
    await processDueFollowUps(h.db, { now: t, organizationId: ctx.organizationId, leadId });
    await h.db.update(followUps).set({ status: "processing", lockedAt: new Date(t.getTime() - 10 * 60_000) }).where(eq(followUps.id, fu1.id));
    await processDueFollowUps(h.db, { now: t, organizationId: ctx.organizationId, leadId });
    const msgs = (await outbound(leadId)).filter((m) => (m.metadata as { followUpId?: string }).followUpId === fu1.id);
    expect(msgs).toHaveLength(1);
    const [after] = await h.db.select().from(followUps).where(eq(followUps.id, fu1.id));
    expect(after.status).toBe("sent");
  });

  it("marks a lead as recovered when it replies after an automated follow-up", async () => {
    const leadId = await newLead("Skylight leaking a little in Elora.");
    await processDueFollowUps(h.db, { now: new Date(Date.now() + 25 * 3600_000), organizationId: ctx.organizationId, leadId });
    const lead = await reply(leadId, "Sorry for the delay! It's a townhouse.");
    expect(lead.recoveredAt).not.toBeNull();
    expect(await eventTypes(leadId)).toContain("lead_recovered");
    expect((await getMetrics(ctx, 30)).recoveredLeads).toBeGreaterThanOrEqual(1);
  });
});

describe("message safety", () => {
  it("opt-out (STOP) revokes consent, cancels follow-ups and blocks all later messages", async () => {
    const leadId = await newLead("Roof repair needed in Cambridge this month.");
    const lead = await reply(leadId, "STOP");
    expect(lead.optedOutAt).not.toBeNull();
    expect((await fus(leadId)).some((f) => f.status === "scheduled")).toBe(false);
    const ai = await sendMessage(ctx, { leadId, body: "Hello again", authorType: "ai", idempotencyKey: `t:${leadId}:ai` });
    expect(ai.status).toBe("blocked");
    const human = await sendStaffMessage(staff, leadId, "Just checking!");
    expect(human.ok).toBe(false);
  });

  it("no consent → automation never messages the lead", async () => {
    const r = await createInboundLead(ctx, { name: "No Consent", email: "nc@example.com", message: "Need a new roof in Guelph", preferredChannel: "email", consent: false } as never, { source: "form" });
    await handleNewLead(ctx, r.leadId);
    const out = await outbound(r.leadId);
    expect(out.every((m) => m.status === "blocked" && m.blockReason === "no_consent")).toBe(true);
    expect(await eventTypes(r.leadId)).toContain("message_blocked");
  });

  it("human takeover stops AI messages; staff can still reply; returning control resumes Signal", async () => {
    const leadId = await newLead("Eavestrough replacement in Fergus please.");
    await takeOver(staff, leadId);
    const countBefore = (await outbound(leadId)).length;
    const after = await reply(leadId, "It's 5 Mill St, a house");
    expect((await outbound(leadId)).length).toBe(countBefore); // no AI reply while a human is in control
    expect(after.controlMode).toBe("human");
    const blocked = await sendMessage(ctx, { leadId, body: "AI attempt", authorType: "ai", idempotencyKey: `t:${leadId}:takeover` });
    expect(blocked).toMatchObject({ status: "blocked", reason: "human_takeover" });
    expect((await sendStaffMessage(staff, leadId, "Hi, this is the owner.")).ok).toBe(true);

    const returned = await returnToSignal(staff, leadId);
    expect(returned.controlMode).toBe("autopilot");
  });

  it("idempotency keys prevent duplicate sends", async () => {
    const leadId = await newLead("Need an inspection in Guelph.");
    const a = await sendMessage(ctx, { leadId, body: "One", authorType: "system", idempotencyKey: `dup:${leadId}` });
    const b = await sendMessage(ctx, { leadId, body: "One", authorType: "system", idempotencyKey: `dup:${leadId}` });
    expect(a.status).toBe("simulated");
    expect(b.status).toBe("duplicate");
  });
});

describe("handoff & edge cases", () => {
  it("an angry customer is handed to a human with a holding reply and owner summary", async () => {
    const leadId = await newLead("You repaired my roof last year and it's leaking AGAIN. This is unacceptable. I want someone to call me today.");
    const lead = await getLead(ctx, leadId);
    expect(lead.stage).toBe("needs_human");
    expect(lead.handoff?.required).toBe(true);
    expect(["high", "urgent"]).toContain(lead.handoff?.priority);
    expect((await outbound(leadId)).at(-1)!.body).toMatch(/team|personally/i);
    expect((await fus(leadId)).some((f) => f.status === "scheduled")).toBe(false);
  });

  it("spam is archived without any reply", async () => {
    const leadId = await newLead("We offer SEO services to rank your website #1! https://spam.example https://spam2.example");
    const lead = await getLead(ctx, leadId);
    expect(lead.stage).toBe("archived");
    expect(lead.isSpam).toBe(true);
    expect((await outbound(leadId)).length).toBe(0);
  });

  it("a lead outside the service area is flagged rather than promised", async () => {
    const leadId = await newLead("Roof repair needed in Toronto next week.");
    const lead = await getLead(ctx, leadId);
    expect(lead.nextAction).toMatch(/confirm/i);
    expect((await outbound(leadId)).at(-1)!.body).toMatch(/outside what we normally handle|team member will review/i);
  });
});
