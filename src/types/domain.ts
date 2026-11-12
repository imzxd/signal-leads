/**
 * Domain vocabulary shared by the database layer, services, agents and UI.
 * Values mirror the CHECK constraints in supabase/migrations.
 */

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "hot",
  "booking",
  "booked",
  "won",
  "lost",
  "archived",
  "needs_human",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const TEMPERATURES = ["cold", "warm", "qualified", "hot"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const URGENCIES = ["emergency", "urgent", "soon", "flexible", "unknown"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const LEAD_SOURCES = [
  "form",
  "embed",
  "api",
  "webhook",
  "manual",
  "email",
  "sms",
  "chat",
  "instagram",
  "facebook",
  "whatsapp",
  "phone",
  "demo",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CONTACT_CHANNELS = ["email", "sms", "web"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONVERSATION_CHANNELS = ["web", "email", "sms", "chat", "instagram", "facebook", "whatsapp", "api"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONTROL_MODES = ["autopilot", "paused", "human"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_AUTHORS = ["lead", "ai", "staff", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

export const MESSAGE_STATUSES = ["queued", "sending", "sent", "delivered", "failed", "blocked", "received", "simulated"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const FOLLOW_UP_STATUSES = ["scheduled", "processing", "sent", "cancelled", "failed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const APPOINTMENT_STATUSES = ["confirmed", "cancelled", "completed", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const AGENT_TYPES = [
  "intake",
  "qualification",
  "knowledge",
  "scoring",
  "follow_up",
  "booking",
  "handoff",
  "summary",
  "drafting",
  "reply_parser",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_RUN_STATUSES = ["succeeded", "fallback", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const KNOWLEDGE_TYPES = ["faq", "service", "policy", "business_info", "document"] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_STATUSES = ["pending", "indexing", "indexed", "failed"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EVENT_ACTORS = ["agent", "system", "staff", "lead"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

/** Stages where automation is finished and must not contact the lead. */
export const TERMINAL_STAGES: readonly LeadStage[] = ["won", "lost", "archived"];

/** Pipeline board columns (spec §15). */
export const PIPELINE_COLUMNS: readonly LeadStage[] = ["new", "qualifying", "qualified", "hot", "booked", "won", "lost"];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  qualified: "Qualified",
  hot: "Hot",
  booking: "Booking",
  booked: "Booked",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
  needs_human: "Needs human",
};

export const TEMPERATURE_LABELS: Record<Temperature, string> = {
  cold: "Cold",
  warm: "Warm",
  qualified: "Qualified",
  hot: "Hot",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  form: "Lead form",
  embed: "Website embed",
  api: "API",
  webhook: "Webhook",
  manual: "Manual",
  email: "Email",
  sms: "SMS",
  chat: "Website chat",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  phone: "Phone",
  demo: "Demo",
};

export const AGENT_LABELS: Record<AgentType, string> = {
  intake: "Intake Agent",
  qualification: "Qualification Agent",
  knowledge: "Knowledge Agent",
  scoring: "Scoring Agent",
  follow_up: "Follow-Up Agent",
  booking: "Booking Agent",
  handoff: "Handoff Agent",
  summary: "Summary",
  drafting: "Drafting Assistant",
  reply_parser: "Reply Parser",
};

/* -------------------------------------------------------------------------- */
/* Organization configuration (stored as JSONB in organization_settings)       */
/* -------------------------------------------------------------------------- */

export interface ServiceOffering {
  key: string;
  name: string;
  description?: string;
  /** Typical job value, used for estimated pipeline value. */
  averageValue: number;
  enabled: boolean;
  /** Words customers use for this service; helps deterministic matching. */
  keywords?: string[];
}

export interface QualificationField {
  key: string;
  label: string;
  /** Natural question the agent can adapt. */
  question: string;
  required: boolean;
  /** Restrict this field to specific service keys; empty = all services. */
  services?: string[];
}

export interface ServiceArea {
  cities: string[];
  postalPrefixes: string[];
  note?: string;
}

export interface DayHours {
  open: string; // "08:00"
  close: string; // "17:00"
}
export type BusinessHours = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", DayHours | null>>;

export interface MessagingHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface FollowUpStep {
  delayHours: number;
  strategy: "gentle_check_in" | "value_reminder" | "last_chance" | "custom";
  template?: string;
}

export interface BookingConfig {
  durationMinutes: number;
  slotsToOffer: number;
  minLeadTimeHours: number;
  appointmentLabel: string;
}

export interface EscalationRules {
  keywords: string[];
  vipValueThreshold: number | null;
  minConfidence: number;
}

export interface FormConfig {
  headline: string;
  subheadline: string;
  askCompany: boolean;
  consentText: string;
  successMessage: string;
}
