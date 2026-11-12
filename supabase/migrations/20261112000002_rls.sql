-- Signal Leads — Row Level Security
--
-- Browser clients (Supabase anon key + user JWT) only ever see rows of organizations
-- they belong to. The Next.js server additionally scopes every query by the
-- organization resolved from the authenticated session, never from client input.

create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.role = any(roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- Organizations ------------------------------------------------------------
alter table public.organizations enable row level security;
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated using (public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

-- Profiles -----------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_select_self_or_teammate on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Memberships ----------------------------------------------------------------
alter table public.organization_members enable row level security;
create policy members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));
create policy members_manage on public.organization_members
  for all to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

-- Settings, automations, API keys, integrations: members read, admins write --------
do $$
declare t text;
begin
  foreach t in array array['organization_settings', 'automations', 'integration_connections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.is_org_member(organization_id))', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_org_role(organization_id, array[''owner'',''admin''])) with check (public.has_org_role(organization_id, array[''owner'',''admin'']))', t, t);
  end loop;
end $$;

alter table public.api_keys enable row level security;
create policy api_keys_admin on public.api_keys
  for all to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']))
  with check (public.has_org_role(organization_id, array['owner', 'admin']));

-- Operational tables: any member of the organization -----------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'leads', 'lead_custom_fields', 'consents', 'conversations', 'messages', 'agent_runs',
    'agent_events', 'lead_scores', 'follow_ups', 'automation_runs', 'appointments',
    'knowledge_documents', 'knowledge_chunks', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_member_all on public.%I for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', t, t);
  end loop;
end $$;

-- Audit logs are append-only for members and readable by admins.
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']));
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated with check (public.is_org_member(organization_id));
