import { and, desc, eq } from "drizzle-orm";
import { createPglite } from "@/server/db/client";
import { applyMigrations } from "@/server/db/migrate";
import { agentEvents, leads, organizations, organizationMembers, organizationSettings, automations, profiles } from "@/server/db/schema";
import { systemContext } from "@/server/context";
import { createInboundLead } from "@/server/services/lead-intake";
import { createDocument } from "@/server/repositories/knowledge";
import { DEFAULT_AUTOMATIONS } from "@/server/repositories/automations";
import { DEFAULT_FORM, DEFAULT_HOURS } from "@/server/repositories/settings";
import { DEMO_KNOWLEDGE, DEMO_QUALIFICATION_FIELDS, DEMO_SERVICE_AREA, DEMO_SERVICES } from "@/server/seed/demo-config";
import { DEFAULT_ESCALATION_RULES } from "@/ai/agents/handoff/triggers";
import { handleNewLead } from "@/ai/orchestrator";
import type { NextActionKind } from "@/ai/orchestrator/decide";
import type { EvalCase } from "./cases";

export interface EvalResult {
  id: string;
  description: string;
  passed: boolean;
  checks: { name: string; passed: boolean; expected: string; actual: string }[];
}

/** Infer which branch the orchestrator took from the lead's final state. */
function actionTaken(stage: string, nextAction: string | null, handoff: boolean, events: string[]): NextActionKind {
  if (stage === "archived") return "ignore_spam";
  if (handoff || stage === "needs_human") return "handoff";
  if (stage === "lost") return "close";
  if (events.includes("booking_offered") || stage === "booking") return "offer_booking";
  if (nextAction?.startsWith("Confirm whether")) return "out_of_scope";
  if (nextAction?.startsWith("Waiting on")) return "ask_question";
  return "nurture";
}

/** Runs every case through the real NEW_LEAD workflow on a fresh in-memory database. */
export async function runEvals(cases: EvalCase[]): Promise<EvalResult[]> {
  const h = await createPglite("memory://");
  await applyMigrations(h.raw, { includeLocalShim: true });
  const [org] = await h.db.insert(organizations).values({ name: "Eval Roofing", slug: "eval-roofing", isDemo: true }).returning();
  const owner = "30000000-0000-4000-8000-000000000001";
  await h.db.insert(profiles).values({ id: owner, fullName: "Eval" });
  await h.db.insert(organizationMembers).values({ organizationId: org.id, userId: owner, role: "owner" });
  await h.db.insert(organizationSettings).values({
    organizationId: org.id,
    businessName: "Evergreen Roofing",
    services: DEMO_SERVICES,
    serviceArea: DEMO_SERVICE_AREA,
    qualificationFields: DEMO_QUALIFICATION_FIELDS,
    businessHours: DEFAULT_HOURS,
    messagingHours: { enabled: false, start: "08:00", end: "20:00" },
    scoringWeights: {},
    escalationRules: DEFAULT_ESCALATION_RULES,
    bookingConfig: {},
    formConfig: DEFAULT_FORM,
  });
  await h.db.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a, organizationId: org.id })));
  const ctx = systemContext(h.db, org.id, "Eval");
  for (const doc of DEMO_KNOWLEDGE) await createDocument(ctx, doc, owner);

  const results: EvalResult[] = [];
  for (const c of cases) {
    const { leadId } = await createInboundLead(ctx, { name: c.name ?? "Eval Lead", email: `${c.id}@example.com`, message: c.message, preferredChannel: "email", consent: true } as never, { source: "form" });
    await handleNewLead(ctx, leadId);
    const [lead] = await h.db.select().from(leads).where(eq(leads.id, leadId));
    const events = (await h.db.select({ t: agentEvents.type }).from(agentEvents).where(and(eq(agentEvents.leadId, leadId))).orderBy(desc(agentEvents.createdAt))).map((e) => e.t);
    const handoff = Boolean(lead.handoff?.required);
    const action = actionTaken(lead.stage, lead.nextAction, handoff, events);
    const checks: EvalResult["checks"] = [];
    const check = (name: string, passed: boolean, expected: unknown, actual: unknown) => checks.push({ name, passed, expected: String(expected), actual: String(actual) });
    if (c.expect.serviceKey !== undefined) check("service", lead.serviceKey === c.expect.serviceKey, c.expect.serviceKey, lead.serviceKey);
    if (c.expect.urgency) check("urgency", c.expect.urgency.includes(lead.urgency), c.expect.urgency.join("|"), lead.urgency);
    check("score", lead.score >= c.expect.score[0] && lead.score <= c.expect.score[1], `${c.expect.score[0]}–${c.expect.score[1]}`, lead.score);
    check("handoff", handoff === c.expect.handoff, c.expect.handoff, handoff);
    check("next action", c.expect.nextAction.includes(action), c.expect.nextAction.join("|"), action);
    results.push({ id: c.id, description: c.description, passed: checks.every((x) => x.passed), checks });
  }
  await h.close();
  return results;
}
