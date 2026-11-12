import type { LeadStage, Priority } from "@/types/domain";

export interface OfferedSlot {
  id: string; // "1", "2", "3" — what the customer can reply with
  startsAt: string; // ISO
  endsAt: string; // ISO
  label: string; // "Thu, Nov 19 · 4:30 PM"
}

export interface BookingState {
  offeredSlots?: OfferedSlot[];
  offeredAt?: string;
  appointmentId?: string;
}

/** Per-lead memory the orchestrator keeps between turns. */
export interface AutomationState {
  /** The qualification field our last message asked about. */
  pendingField?: string | null;
  askCounts?: Record<string, number>;
  /** Consecutive agent runs that fell back to heuristics (repeated model failure trigger). */
  consecutiveFallbacks?: number;
  lastSummaryMessageCount?: number;
}

export interface HandoffState {
  required: boolean;
  priority: Priority;
  reason: string;
  ownerSummary: string;
  requestedAt: string;
  resolvedAt?: string;
}

/**
 * Allowed automated stage transitions. Staff can move a lead anywhere (with an event);
 * automation may only move it along these edges so a misbehaving agent cannot,
 * for example, reopen a won deal.
 */
const AUTOMATED_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ["contacted", "qualifying", "qualified", "hot", "needs_human", "archived", "lost"],
  contacted: ["qualifying", "qualified", "hot", "booking", "needs_human", "lost", "archived"],
  qualifying: ["qualified", "hot", "booking", "needs_human", "lost", "archived"],
  qualified: ["qualifying", "hot", "booking", "booked", "needs_human", "lost"],
  hot: ["qualifying", "qualified", "booking", "booked", "needs_human", "lost"],
  booking: ["booked", "qualified", "hot", "needs_human", "lost"],
  booked: ["won", "needs_human", "lost"],
  won: [],
  lost: [],
  archived: [],
  needs_human: [],
};

export function canAutomationTransition(from: LeadStage, to: LeadStage): boolean {
  if (from === to) return true;
  return AUTOMATED_TRANSITIONS[from].includes(to);
}
