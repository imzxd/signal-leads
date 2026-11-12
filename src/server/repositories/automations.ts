import { and, eq } from "drizzle-orm";
import { automationRuns, automations, type Automation } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";

export const AUTOMATION_KEYS = {
  newLead: "new_lead_qualification",
  followUp1: "follow_up_1",
  followUp2: "follow_up_2",
  followUp3: "follow_up_3",
  hotLeadAlert: "hot_lead_alert",
  bookingOffer: "booking_offer",
  appointmentConfirmation: "appointment_confirmation",
  humanEscalation: "human_escalation",
} as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[keyof typeof AUTOMATION_KEYS];

export function followUpAutomationKey(sequenceNumber: number): AutomationKey {
  return sequenceNumber <= 1 ? AUTOMATION_KEYS.followUp1 : sequenceNumber === 2 ? AUTOMATION_KEYS.followUp2 : AUTOMATION_KEYS.followUp3;
}

export const DEFAULT_AUTOMATIONS: Omit<typeof automations.$inferInsert, "organizationId">[] = [
  {
    key: AUTOMATION_KEYS.newLead,
    name: "New Lead Qualification",
    description: "Reads every new lead, extracts details, scores it and sends a tailored first response within seconds.",
    trigger: "Lead received (form, embed, API or webhook)",
    conditions: ["Autopilot is on", "Lead gave consent for the channel", "Not spam"],
    actions: ["Intake Agent extracts details", "Qualification Agent picks the next question", "Scoring engine rates the lead", "Send first response"],
  },
  {
    key: AUTOMATION_KEYS.followUp1,
    name: "24-Hour Follow-Up",
    description: "Gently checks in when a lead hasn't replied after a day.",
    trigger: "24 hours after our last message without a reply",
    conditions: ["Lead hasn't replied", "Not opted out", "Autopilot is on", "Within messaging hours"],
    actions: ["Follow-Up Agent writes a check-in", "Send via the lead's preferred channel"],
  },
  {
    key: AUTOMATION_KEYS.followUp2,
    name: "72-Hour Follow-Up",
    description: "A second, value-focused nudge for leads that went quiet.",
    trigger: "72 hours after our last message without a reply",
    conditions: ["Lead hasn't replied", "Not opted out", "Autopilot is on"],
    actions: ["Follow-Up Agent writes a reminder", "Send via the lead's preferred channel"],
  },
  {
    key: AUTOMATION_KEYS.followUp3,
    name: "7-Day Final Follow-Up",
    description: "A polite last check before the request is closed out.",
    trigger: "7 days after our last message without a reply",
    conditions: ["Lead hasn't replied", "Not opted out", "Autopilot is on"],
    actions: ["Follow-Up Agent writes a final note", "Stop the sequence"],
  },
  {
    key: AUTOMATION_KEYS.hotLeadAlert,
    name: "Hot Lead Owner Alert",
    description: "Notifies the team the moment a lead scores 80 or higher.",
    trigger: "Lead score reaches HOT (80+)",
    conditions: ["Not previously alerted for this lead"],
    actions: ["Create an urgent notification", "Send to n8n for SMS/Slack alerts"],
  },
  {
    key: AUTOMATION_KEYS.bookingOffer,
    name: "Booking Offer",
    description: "Offers real open times from the calendar once a lead is qualified.",
    trigger: "Qualification complete and score ≥ 60",
    conditions: ["Autopilot is on", "Calendar has availability"],
    actions: ["Fetch availability from the calendar provider", "Offer the next open times", "Book the chosen slot"],
  },
  {
    key: AUTOMATION_KEYS.appointmentConfirmation,
    name: "Appointment Confirmation",
    description: "Confirms the booking with the customer and alerts the owner.",
    trigger: "Appointment created",
    conditions: ["Lead gave consent for the channel"],
    actions: ["Send confirmation", "Notify the owner"],
  },
  {
    key: AUTOMATION_KEYS.humanEscalation,
    name: "Human Escalation",
    description: "Stops automation and briefs the owner when a person is needed.",
    trigger: "Angry customer, legal threat, request for a human, low confidence or business rule",
    conditions: ["Always on for safety-critical triggers"],
    actions: ["Pause outbound AI messages", "Send a holding reply", "Notify the owner with a summary"],
  },
];

export async function getAutomation(ctx: OrgContext, key: AutomationKey): Promise<Automation | null> {
  const [row] = await ctx.db
    .select()
    .from(automations)
    .where(and(eq(automations.organizationId, ctx.organizationId), eq(automations.key, key)))
    .limit(1);
  return row ?? null;
}

/** Missing automation rows default to enabled so a partially-configured org still works. */
export async function isAutomationEnabled(ctx: OrgContext, key: AutomationKey): Promise<boolean> {
  const row = await getAutomation(ctx, key);
  return row ? row.enabled : true;
}

export async function recordAutomationRun(
  ctx: OrgContext,
  key: AutomationKey,
  leadId: string | null,
  status: "succeeded" | "failed" | "skipped",
  detail?: string,
  error?: string,
) {
  const automation = await getAutomation(ctx, key);
  if (!automation) return;
  await ctx.db.insert(automationRuns).values({
    organizationId: ctx.organizationId,
    automationId: automation.id,
    leadId,
    status,
    detail: detail ?? null,
    error: error ?? null,
  });
}
