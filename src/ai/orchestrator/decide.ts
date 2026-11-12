import type { LeadStage, Temperature } from "@/types/domain";
import type { TriState } from "@/features/leads/scoring/types";

/**
 * The orchestrator's next-action policy. Pure and deterministic: agents supply facts and
 * judgements, this function decides what happens next. Easy to test, easy to explain.
 */
export type NextActionKind = "ignore_spam" | "handoff" | "close" | "out_of_scope" | "ask_question" | "offer_booking" | "nurture";

export interface DecisionInput {
  isSpam: boolean;
  handoffRequired: boolean;
  notInterested: boolean;
  serviceSupported: TriState;
  inServiceArea: TriState;
  qualificationComplete: boolean;
  targetField: string | null;
  score: number;
  /** Booking threshold (default 60 = QUALIFIED). */
  bookingThreshold?: number;
  alreadyBooked: boolean;
}

export interface Decision {
  kind: NextActionKind;
  stage: LeadStage;
  label: string;
  reason: string;
}

export function decideNextAction(d: DecisionInput): Decision {
  const threshold = d.bookingThreshold ?? 60;
  if (d.isSpam) return { kind: "ignore_spam", stage: "archived", label: "Ignored — spam", reason: "Message classified as spam" };
  if (d.handoffRequired) return { kind: "handoff", stage: "needs_human", label: "Reply personally", reason: "Needs human judgement" };
  if (d.notInterested) return { kind: "close", stage: "lost", label: "Closed — customer not interested", reason: "Customer said they're no longer interested" };
  if (d.alreadyBooked) return { kind: "nurture", stage: "booked", label: "Appointment booked", reason: "Already booked" };
  if (d.serviceSupported === "no" || d.inServiceArea === "no") {
    return {
      kind: "out_of_scope",
      stage: "qualifying",
      label: "Confirm whether we can help",
      reason: d.serviceSupported === "no" ? "Requested service isn't offered" : "Location is outside the service area",
    };
  }
  if (!d.qualificationComplete && d.targetField) {
    return { kind: "ask_question", stage: "qualifying", label: `Waiting on: ${d.targetField.replace(/_/g, " ")}`, reason: "Required details are missing" };
  }
  if (d.score >= threshold) return { kind: "offer_booking", stage: "booking", label: "Offer appointment", reason: "Qualified with strong intent" };
  return { kind: "nurture", stage: "qualified", label: "Nurture — follow up", reason: "Details complete, intent still forming" };
}

/** Pipeline column for a stage (spec §15 board has 7 columns). */
export function pipelineColumnFor(stage: LeadStage, temperature: Temperature): LeadStage | null {
  switch (stage) {
    case "new":
    case "contacted":
      return "new";
    case "qualifying":
    case "needs_human":
      return "qualifying";
    case "qualified":
      return temperature === "hot" ? "hot" : "qualified";
    case "hot":
    case "booking":
      return "hot";
    case "booked":
      return "booked";
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "archived":
      return null;
  }
}
