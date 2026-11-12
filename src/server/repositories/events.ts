import { and, asc, eq } from "drizzle-orm";
import { agentEvents, type AgentEvent } from "@/server/db/schema";
import type { OrgContext } from "@/server/context";
import type { DecisionReceipt } from "@/features/leads/receipts";
import type { EventActor } from "@/types/domain";

export type EventType =
  | "lead_received"
  | "intake_completed"
  | "validation"
  | "qualification"
  | "question_asked"
  | "knowledge_answered"
  | "knowledge_escalated"
  | "score_changed"
  | "message_sent"
  | "message_blocked"
  | "message_failed"
  | "reply_received"
  | "follow_up_scheduled"
  | "follow_up_sent"
  | "follow_up_cancelled"
  | "lead_recovered"
  | "booking_offered"
  | "appointment_created"
  | "appointment_cancelled"
  | "owner_notified"
  | "handoff_requested"
  | "takeover"
  | "returned_to_signal"
  | "autopilot_paused"
  | "autopilot_resumed"
  | "stage_changed"
  | "assigned"
  | "converted"
  | "lost"
  | "opted_out"
  | "note"
  | "ai_suggestion"
  | "error";

export interface NewEvent {
  leadId: string;
  type: EventType;
  actor: EventActor;
  actorLabel: string;
  title: string;
  detail?: string | null;
  receipt?: DecisionReceipt | null;
  agentRunId?: string | null;
  at?: Date;
}

export async function recordEvent(ctx: OrgContext, e: NewEvent): Promise<AgentEvent> {
  const [row] = await ctx.db
    .insert(agentEvents)
    .values({
      organizationId: ctx.organizationId,
      leadId: e.leadId,
      agentRunId: e.agentRunId ?? null,
      type: e.type,
      actor: e.actor,
      actorLabel: e.actorLabel,
      title: e.title,
      detail: e.detail ?? null,
      receipt: e.receipt ?? null,
      ...(e.at ? { createdAt: e.at } : {}),
    })
    .returning();
  return row;
}

export async function listEvents(ctx: OrgContext, leadId: string): Promise<AgentEvent[]> {
  return ctx.db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.leadId, leadId), eq(agentEvents.organizationId, ctx.organizationId)))
    .orderBy(asc(agentEvents.createdAt));
}
