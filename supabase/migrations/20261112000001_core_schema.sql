-- Signal Leads — core schema
-- Every tenant-owned table carries organization_id and is protected by RLS (see 20261112000002_rls.sql).
-- Enum-like columns use CHECK constraints so values can evolve without enum migrations.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  industry text,
  timezone text not null default 'America/Toronto',
  status text not null default 'active' check (status in ('active', 'suspended')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key, -- equals auth.users.id
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  business_name text not null,
  phone text,
  email text,
  website text,
  address text,
  brand_voice text,
  average_deal_value numeric(12, 2) not null default 0,
  services jsonb not null default '[]'::jsonb,
  service_area jsonb not null default '{}'::jsonb,
  qualification_fields jsonb not null default '[]'::jsonb,
  business_hours jsonb not null default '{}'::jsonb,
  messaging_hours jsonb not null default '{"enabled": false, "start": "08:00", "end": "20:00"}'::jsonb,
  follow_up_sequence jsonb not null default '[]'::jsonb,
  scoring_weights jsonb not null default '{}'::jsonb,
  escalation_rules jsonb not null default '{}'::jsonb,
  booking_config jsonb not null default '{}'::jsonb,
  form_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leads & CRM
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  email text,
  phone text,
  company text,
  source text not null default 'form'
    check (source in ('form', 'embed', 'api', 'webhook', 'manual', 'email', 'sms', 'chat', 'instagram', 'facebook', 'whatsapp', 'phone', 'demo')),
  preferred_channel text not null default 'email' check (preferred_channel in ('email', 'sms', 'web')),
  service_key text,
  service_requested text,
  intent text,
  urgency text not null default 'unknown' check (urgency in ('emergency', 'urgent', 'soon', 'flexible', 'unknown')),
  timeline text,
  budget text,
  location text,
  address text,
  summary text,
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'qualifying', 'qualified', 'hot', 'booking', 'booked', 'won', 'lost', 'archived', 'needs_human')),
  score integer not null default 0 check (score between 0 and 100),
  temperature text not null default 'cold' check (temperature in ('cold', 'warm', 'qualified', 'hot')),
  estimated_value numeric(12, 2),
  won_value numeric(12, 2),
  control_mode text not null default 'autopilot' check (control_mode in ('autopilot', 'paused', 'human')),
  assigned_to uuid references public.profiles(id) on delete set null,
  missing_fields text[] not null default '{}',
  qualification_complete boolean not null default false,
  next_action text,
  next_action_at timestamptz,
  ai_confidence numeric(4, 3),
  is_spam boolean not null default false,
  is_existing_customer boolean not null default false,
  booking_state jsonb not null default '{}'::jsonb,
  automation_state jsonb not null default '{}'::jsonb, -- pending question, ask counts, fallback streak
  handoff jsonb,
  last_contact_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  first_response_at timestamptz,
  opted_out_at timestamptz,
  recovered_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_org_created_idx on public.leads(organization_id, created_at desc);
create index leads_org_stage_idx on public.leads(organization_id, stage);
create index leads_org_temperature_idx on public.leads(organization_id, temperature);
create index leads_org_score_idx on public.leads(organization_id, score desc);
create index leads_org_email_idx on public.leads(organization_id, lower(email));
create index leads_org_phone_idx on public.leads(organization_id, phone);

create table public.lead_custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value text not null,
  source text not null default 'ai' check (source in ('ai', 'staff', 'form', 'api')),
  confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, key)
);
create index lead_custom_fields_org_idx on public.lead_custom_fields(organization_id);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'web')),
  granted boolean not null,
  source text not null, -- e.g. 'form_checkbox', 'inbound_message', 'staff', 'opt_out_keyword'
  evidence text,
  ip_address text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index consents_lead_idx on public.consents(lead_id, channel, created_at desc);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null default 'web' check (channel in ('web', 'email', 'sms', 'chat', 'instagram', 'facebook', 'whatsapp', 'api')),
  status text not null default 'open' check (status in ('open', 'closed')),
  subject text,
  summary text,
  summary_message_count integer not null default 0,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_last_idx on public.conversations(organization_id, last_message_at desc nulls last);
create index conversations_lead_idx on public.conversations(lead_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  author_type text not null check (author_type in ('lead', 'ai', 'staff', 'system')),
  author_id uuid references public.profiles(id) on delete set null,
  channel text not null,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'blocked', 'received', 'simulated')),
  provider text,
  provider_message_id text,
  idempotency_key text,
  block_reason text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, idempotency_key)
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);
create index messages_lead_idx on public.messages(lead_id, created_at);
create index messages_org_created_idx on public.messages(organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI agents, decisions, scoring
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  agent text not null
    check (agent in ('intake', 'qualification', 'knowledge', 'scoring', 'follow_up', 'booking', 'handoff', 'summary', 'drafting', 'reply_parser')),
  provider text not null,
  model text not null,
  status text not null check (status in ('succeeded', 'fallback', 'failed')),
  input jsonb,
  output jsonb,
  confidence numeric(4, 3),
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12, 6),
  latency_ms integer,
  attempts integer not null default 1,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_org_created_idx on public.agent_runs(organization_id, created_at desc);
create index agent_runs_lead_idx on public.agent_runs(lead_id, created_at desc);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  type text not null,
  actor text not null check (actor in ('agent', 'system', 'staff', 'lead')),
  actor_label text not null,
  title text not null,
  detail text,
  receipt jsonb,
  created_at timestamptz not null default now()
);
create index agent_events_lead_idx on public.agent_events(lead_id, created_at);
create index agent_events_org_created_idx on public.agent_events(organization_id, created_at desc);

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  score integer not null check (score between 0 and 100),
  previous_score integer,
  temperature text not null check (temperature in ('cold', 'warm', 'qualified', 'hot')),
  factors jsonb not null default '[]'::jsonb,
  explanation text,
  recommended_action text,
  source text not null default 'engine' check (source in ('engine', 'manual')),
  created_at timestamptz not null default now()
);
create index lead_scores_lead_idx on public.lead_scores(lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Follow-ups (persisted, restart-safe, idempotent)
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'web')),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'sent', 'cancelled', 'failed')),
  sequence_number integer not null check (sequence_number >= 1),
  strategy text not null,
  idempotency_key text not null,
  attempts integer not null default 0,
  locked_at timestamptz,
  message_id uuid references public.messages(id) on delete set null,
  cancel_reason text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  cancelled_at timestamptz,
  unique (organization_id, idempotency_key)
);
create index follow_ups_due_idx on public.follow_ups(status, scheduled_for) where status in ('scheduled', 'processing');
create index follow_ups_lead_idx on public.follow_ups(lead_id, sequence_number);

-- ---------------------------------------------------------------------------
-- Automations
-- ---------------------------------------------------------------------------
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  trigger text not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  status text not null check (status in ('succeeded', 'failed', 'skipped')),
  detail text,
  error text,
  created_at timestamptz not null default now()
);
create index automation_runs_automation_idx on public.automation_runs(automation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  provider text not null,
  external_id text,
  location text,
  notes text,
  created_by text not null check (created_by in ('agent', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_org_starts_idx on public.appointments(organization_id, starts_at);
create index appointments_lead_idx on public.appointments(lead_id);

-- ---------------------------------------------------------------------------
-- Knowledge (RAG)
-- ---------------------------------------------------------------------------
create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  type text not null check (type in ('faq', 'service', 'policy', 'business_info', 'document')),
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'indexing', 'indexed', 'failed')),
  chunk_count integer not null default 0,
  last_indexed_at timestamptz,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_documents_org_idx on public.knowledge_documents(organization_id, updated_at desc);

-- 1024 dimensions: matches Voyage (output_dimension=1024) and the local development embedder.
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1024),
  embedding_model text not null,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index knowledge_chunks_org_idx on public.knowledge_chunks(organization_id);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);
create index knowledge_chunks_fts_idx on public.knowledge_chunks using gin (fts);

-- ---------------------------------------------------------------------------
-- Notifications, audit, integrations, API keys
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade, -- null = all members
  lead_id uuid references public.leads(id) on delete cascade,
  type text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_org_created_idx on public.notifications(organization_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('twilio', 'resend', 'n8n', 'google_calendar', 'outlook', 'calendly')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  config jsonb not null default '{}'::jsonb, -- never store secrets here; secrets live in env / a vault
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique, -- sha256 of the full key; the plaintext is shown once
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'organization_members', 'organization_settings', 'leads',
    'lead_custom_fields', 'conversations', 'follow_ups', 'automations', 'appointments',
    'knowledge_documents', 'integration_connections'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
