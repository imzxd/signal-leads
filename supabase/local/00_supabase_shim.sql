-- LOCAL DEVELOPMENT ONLY — applied to the embedded PGlite database before migrations.
-- Recreates the small slice of Supabase that our migrations depend on
-- (roles, auth schema, auth.uid(), auth.users). Never apply this to Supabase.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
-- Supabase grants table privileges to these roles by default; RLS then restricts rows.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
