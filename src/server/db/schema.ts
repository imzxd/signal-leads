/**
 * Typed mapping of supabase/migrations. The SQL migrations are the source of truth;
 * this file must stay in sync (integration tests run every query against the real
 * migrated schema, so drift fails CI).
 */
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type {
  BookingConfig,
  BusinessHours,
  EscalationRules,
  FollowUpStep,
  FormConfig,
  MessagingHours,
  QualificationField,
  ServiceArea,
  ServiceOffering,
} from "@/types/domain";
import {
  AGENT_RUN_STATUSES,
  AGENT_TYPES,
  APPOINTMENT_STATUSES,
  CONTACT_CHANNELS,
  CONTROL_MODES,
  CONVERSATION_CHANNELS,
  EVENT_ACTORS,
  FOLLOW_UP_STATUSES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  LEAD_SOURCES,
  LEAD_STAGES,
  MEMBER_ROLES,
  MESSAGE_AUTHORS,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  PRIORITIES,
  TEMPERATURES,
  URGENCIES,
} from "@/types/domain";
import type { ScoringWeights, ScoreFactor } from "@/features/leads/scoring/types";
import type { DecisionReceipt } from "@/features/leads/receipts";
import type { AutomationState, BookingState, HandoffState } from "@/features/leads/lead-state";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const ratio = (name: string) => numeric(name, { precision: 4, scale: 3, mode: "number" });

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  timezone: text("timezone").notNull().default("America/Toronto"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  brandVoice: text("brand_voice"),
  averageDealValue: money("average_deal_value").notNull().default(0),
  services: jsonb("services").$type<ServiceOffering[]>().notNull().default([]),
  serviceArea: jsonb("service_area").$type<ServiceArea>().notNull(),
  qualificationFields: jsonb("qualification_fields").$type<QualificationField[]>().notNull().default([]),
  businessHours: jsonb("business_hours").$type<BusinessHours>().notNull(),
  messagingHours: jsonb("messaging_hours").$type<MessagingHours>().notNull(),
  followUpSequence: jsonb("follow_up_sequence").$type<FollowUpStep[]>().notNull().default([]),
  scoringWeights: jsonb("scoring_weights").$type<Partial<ScoringWeights>>().notNull(),
  escalationRules: jsonb("escalation_rules").$type<Partial<EscalationRules>>().notNull(),
  bookingConfig: jsonb("booking_config").$type<Partial<BookingConfig>>().notNull(),
  formConfig: jsonb("form_config").$type<Partial<FormConfig>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  source: text("source", { enum: LEAD_SOURCES }).notNull().default("form"),
  preferredChannel: text("preferred_channel", { enum: CONTACT_CHANNELS }).notNull().default("email"),
  serviceKey: text("service_key"),
  serviceRequested: text("service_requested"),
  intent: text("intent"),
  urgency: text("urgency", { enum: URGENCIES }).notNull().default("unknown"),
  timeline: text("timeline"),
  budget: text("budget"),
  location: text("location"),
  address: text("address"),
  summary: text("summary"),
  stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
  score: integer("score").notNull().default(0),
  temperature: text("temperature", { enum: TEMPERATURES }).notNull().default("cold"),
  estimatedValue: money("estimated_value"),
  wonValue: money("won_value"),
  controlMode: text("control_mode", { enum: CONTROL_MODES }).notNull().default("autopilot"),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  missingFields: text("missing_fields").array().notNull().default([]),
  qualificationComplete: boolean("qualification_complete").notNull().default(false),
  nextAction: text("next_action"),
  nextActionAt: ts("next_action_at"),
  aiConfidence: ratio("ai_confidence"),
  isSpam: boolean("is_spam").notNull().default(false),
  isExistingCustomer: boolean("is_existing_customer").notNull().default(false),
  bookingState: jsonb("booking_state").$type<BookingState>().notNull().default({}),
  automationState: jsonb("automation_state").$type<AutomationState>().notNull().default({}),
  handoff: jsonb("handoff").$type<HandoffState | null>(),
  lastContactAt: ts("last_contact_at"),
  lastInboundAt: ts("last_inbound_at"),
  lastOutboundAt: ts("last_outbound_at"),
  firstResponseAt: ts("first_response_at"),
  optedOutAt: ts("opted_out_at"),
  recoveredAt: ts("recovered_at"),
  wonAt: ts("won_at"),
  lostAt: ts("lost_at"),
  lostReason: text("lost_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leadCustomFields = pgTable("lead_custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  source: text("source", { enum: ["ai", "staff", "form", "api"] }).notNull().default("ai"),
  confidence: ratio("confidence"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: CONTACT_CHANNELS }).notNull(),
  granted: boolean("granted").notNull(),
  source: text("source").notNull(),
  evidence: text("evidence"),
  ipAddress: text("ip_address"),
  createdAt: createdAt(),
  revokedAt: ts("revoked_at"),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: CONVERSATION_CHANNELS }).notNull().default("web"),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  subject: text("subject"),
  summary: text("summary"),
  summaryMessageCount: integer("summary_message_count").notNull().default(0),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: ts("last_message_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
  authorType: text("author_type", { enum: MESSAGE_AUTHORS }).notNull(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("queued"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  idempotencyKey: text("idempotency_key"),
  blockReason: text("block_reason"),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  agent: text("agent", { enum: AGENT_TYPES }).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: AGENT_RUN_STATUSES }).notNull(),
  input: jsonb("input").$type<unknown>(),
  output: jsonb("output").$type<unknown>(),
  confidence: ratio("confidence"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6, mode: "number" }),
  latencyMs: integer("latency_ms"),
  attempts: integer("attempts").notNull().default(1),
  error: text("error"),
  createdAt: createdAt(),
});

export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  actor: text("actor", { enum: EVENT_ACTORS }).notNull(),
  actorLabel: text("actor_label").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  receipt: jsonb("receipt").$type<DecisionReceipt | null>(),
  createdAt: createdAt(),
});

export const leadScores = pgTable("lead_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  temperature: text("temperature", { enum: TEMPERATURES }).notNull(),
  factors: jsonb("factors").$type<ScoreFactor[]>().notNull().default([]),
  explanation: text("explanation"),
  recommendedAction: text("recommended_action"),
  source: text("source", { enum: ["engine", "manual"] }).notNull().default("engine"),
  createdAt: createdAt(),
});

export const followUps = pgTable("follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: CONTACT_CHANNELS }).notNull(),
  scheduledFor: ts("scheduled_for").notNull(),
  status: text("status", { enum: FOLLOW_UP_STATUSES }).notNull().default("scheduled"),
  sequenceNumber: integer("sequence_number").notNull(),
  strategy: text("strategy").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lockedAt: ts("locked_at"),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  cancelReason: text("cancel_reason"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  executedAt: ts("executed_at"),
  cancelledAt: ts("cancelled_at"),
});

export const automations = pgTable("automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
  actions: jsonb("actions").$type<string[]>().notNull().default([]),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  status: text("status", { enum: ["succeeded", "failed", "skipped"] }).notNull(),
  detail: text("detail"),
  error: text("error"),
  createdAt: createdAt(),
});

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  status: text("status", { enum: APPOINTMENT_STATUSES }).notNull().default("confirmed"),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  location: text("location"),
  notes: text("notes"),
  createdBy: text("created_by", { enum: ["agent", "staff"] }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type", { enum: KNOWLEDGE_TYPES }).notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: KNOWLEDGE_STATUSES }).notNull().default("pending"),
  chunkCount: integer("chunk_count").notNull().default(0),
  lastIndexedAt: ts("last_indexed_at"),
  error: text("error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  embeddingModel: text("embedding_model").notNull(),
  tokenEstimate: integer("token_estimate").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  // `fts` is a generated tsvector column; queried with raw SQL only.
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
  title: text("title").notNull(),
  body: text("body"),
  readAt: ts("read_at"),
  createdAt: createdAt(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => profiles.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["twilio", "resend", "n8n", "google_calendar", "outlook", "calendly"] }).notNull(),
  status: text("status", { enum: ["connected", "disconnected", "error"] }).notNull().default("disconnected"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

export type Organization = typeof organizations.$inferSelect;
export type OrganizationSettingsRow = typeof organizationSettings.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type LeadScore = typeof leadScores.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
