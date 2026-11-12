import type { FollowUp, Lead } from "@/server/db/schema";

export type FollowUpStopReason =
  | "lead_responded"
  | "opted_out"
  | "converted"
  | "lost"
  | "closed"
  | "booked"
  | "needs_human"
  | "human_takeover"
  | "autopilot_paused"
  | "max_reached";

export const STOP_REASON_LABELS: Record<FollowUpStopReason, string> = {
  lead_responded: "Lead replied",
  opted_out: "Lead opted out",
  converted: "Lead converted",
  lost: "Lead marked lost",
  closed: "Lead archived",
  booked: "Appointment booked",
  needs_human: "Handed off to a person",
  human_takeover: "Team member took over",
  autopilot_paused: "Autopilot paused",
  max_reached: "Maximum follow-ups reached",
};

/**
 * Deterministic: should this scheduled follow-up be cancelled instead of sent?
 * (Consent and automation-enabled checks happen in the outbound messaging service.)
 */
export function followUpStopReason(lead: Lead, followUp: Pick<FollowUp, "createdAt" | "sequenceNumber">, maxSteps: number): FollowUpStopReason | null {
  if (lead.optedOutAt) return "opted_out";
  if (lead.stage === "won") return "converted";
  if (lead.stage === "lost") return "lost";
  if (lead.stage === "archived") return "closed";
  if (lead.stage === "booked") return "booked";
  if (lead.stage === "needs_human") return "needs_human";
  if (lead.controlMode === "human") return "human_takeover";
  if (lead.controlMode === "paused") return "autopilot_paused";
  if (lead.lastInboundAt && lead.lastInboundAt > followUp.createdAt) return "lead_responded";
  if (followUp.sequenceNumber > maxSteps) return "max_reached";
  return null;
}
