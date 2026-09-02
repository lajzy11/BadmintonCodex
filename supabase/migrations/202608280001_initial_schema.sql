-- Badminton Match Master V2.4
-- Initial PostgreSQL schema, constraints, indexes and RLS policies.

create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'admin', 'member');
create type public.activity_status as enum ('draft', 'scheduled', 'in_progress', 'ended', 'archived');
create type public.assign_mode as enum ('system_assign', 'manual_assign', 'free_play');
create type public.capacity_mode as enum ('unlimited', 'limited');
create type public.member_gender as enum ('M', 'F');
create type public.checkin_status as enum ('not_arrived', 'checked_in');
create type public.attendance_state as enum ('idle', 'playing', 'rest');
create type public.registration_status as enum ('active', 'cancelled');
create type public.payment_status as enum ('unpaid', 'paid');
create type public.no_show_status as enum ('pending_charge', 'charged', 'waived', 'cancelled');
create type public.member_source as enum ('manual', 'import', 'self_claim');
create type public.claim_status as enum ('unclaimed', 'claimed');
create type public.court_status as enum ('idle', 'playing');
create type public.queue_source as enum ('system', 'manual');
create type public.relationship_type as enum ('persistent_bind', 'one_match_bind', 'one_match_oppose', 'avoid_same_match');
create type public.match_status as enum ('in_progress', 'completed', 'cancelled');
create type public.match_result as enum ('team_a_win', 'team_b_win', 'no_result', 'unrecorded');
create type public.assignment_source as enum ('auto_mode', 'preview_manual', 'direct_manual');
create type public.payment_environment as enum ('demo', 'live');
create type public.transaction_status as enum ('pending', 'paid', 'failed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  username_normalized text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username_normalized ~ '^[a-z0-9_]{4,30}$'
    and username_normalized ~ '[a-z0-9]'
    and username_normalized = lower(username_normalized)
  ),
  constraint profiles_display_name_not_blank check (length(btrim(display_name)) > 0)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_contact_info text,
  default_shuttlecock text,
  description text,
  line_pay_demo_enabled boolean not null default false,
  line_pay_demo_merchant_name text,
  line_pay_demo_merchant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(btrim(name)) > 0),
  constraint organizations_demo_config check (
    not line_pay_demo_enabled
    or (
      nullif(btrim(line_pay_demo_merchant_name), '') is not null
      and nullif(btrim(line_pay_demo_merchant_id), '') is not null
    )
  )
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create unique index one_owned_organization_per_user_v1
  on public.organization_memberships(user_id)
  where role = 'owner';

create table public.organizer_venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  region text not null,
  district text not null,
  address text,
  floor_type text,
  note text,
  last_used_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizer_venues_name_not_blank check (length(btrim(name)) > 0),
  constraint organizer_venues_region_not_blank check (length(btrim(region)) > 0),
  constraint organizer_venues_district_not_blank check (length(btrim(district)) > 0),
  constraint organizer_venues_use_count_nonnegative check (use_count >= 0)
);

create index organizer_venues_org_recent_idx
  on public.organizer_venues(organization_id, last_used_at desc nulls last);
create index organizer_venues_org_location_idx
  on public.organizer_venues(organization_id, region, district);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  custom_title text,
  status public.activity_status not null default 'draft',
  activity_date date not null,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  ended_at timestamptz,
  archived_at timestamptz,
  venue_snapshot jsonb not null,
  initial_court_count smallint not null default 1,
  capacity_mode public.capacity_mode not null default 'limited',
  capacity_limit smallint default 8,
  skill_min smallint not null default 1,
  skill_max smallint not null default 18,
  assign_mode public.assign_mode not null default 'system_assign',
  finance_enabled boolean not null default true,
  enabled_payment_methods text[] not null default array['cash']::text[],
  default_payment_method text,
  auto_time_eligibility_enabled boolean not null default true,
  line_pay_self_checkin_enabled boolean not null default false,
  matching_settings jsonb not null default '{"priority":"balanced","levelMatch":"balanced","repeatAvoidance":"moderate","genderPreference":"none"}'::jsonb,
  tts_settings jsonb not null default '{"enabled":true,"repeatCount":2,"rate":1.0}'::jsonb,
  shuttlecock text,
  contact_info text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_date_not_before_creation_day check (activity_date >= (created_at at time zone 'Asia/Taipei')::date),
  constraint activities_time_order check (
    scheduled_start_at is null
    or scheduled_end_at is null
    or scheduled_end_at > scheduled_start_at
  ),
  constraint activities_initial_court_count check (initial_court_count between 1 and 20),
  constraint activities_capacity check (
    (capacity_mode = 'unlimited' and capacity_limit is null)
    or (capacity_mode = 'limited' and capacity_limit between 1 and 100)
  ),
  constraint activities_skill_range check (
    skill_min between 1 and 18
    and skill_max between 1 and 18
    and skill_min <= skill_max
  ),
  constraint activities_payment_methods check (
    (not finance_enabled)
    or cardinality(enabled_payment_methods) >= 1
  ),
  constraint activities_default_payment_method check (
    default_payment_method is null
    or default_payment_method = any(enabled_payment_methods)
  ),
  constraint activities_line_pay_self_checkin check (
    not line_pay_self_checkin_enabled
    or (
      finance_enabled
      and 'line_pay' = any(enabled_payment_methods)
    )
  ),
  constraint activities_venue_snapshot check (
    nullif(btrim(venue_snapshot->>'name'), '') is not null
    and nullif(btrim(venue_snapshot->>'region'), '') is not null
    and nullif(btrim(venue_snapshot->>'district'), '') is not null
  ),
  constraint activities_status_timestamps check (
    (status <> 'ended' or ended_at is not null)
    and (status <> 'archived' or archived_at is not null)
  )
);

create index activities_org_status_start_idx
  on public.activities(organization_id, status, scheduled_start_at);
create index activities_org_updated_idx
  on public.activities(organization_id, updated_at desc);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  code char(1) not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  amount integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, code),
  constraint plans_code check (code between 'A' and 'E'),
  constraint plans_time_order check (end_at > start_at),
  constraint plans_amount check (amount is null or amount between 0 and 10000)
);

create index plans_activity_time_idx on public.plans(activity_id, start_at, end_at);

create table public.activity_members (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  display_name text not null,
  disambiguation_label text,
  gender public.member_gender,
  level smallint not null,
  plan_id uuid not null references public.plans(id) on delete restrict,
  checkin_status public.checkin_status not null default 'not_arrived',
  attendance_state public.attendance_state not null default 'idle',
  registration_status public.registration_status not null default 'active',
  payment_status public.payment_status not null default 'unpaid',
  payment_method text,
  no_show_status public.no_show_status,
  note text,
  claim_status public.claim_status not null default 'unclaimed',
  claimed_at timestamptz,
  claimed_session_id uuid,
  source public.member_source not null default 'manual',
  source_order integer not null default 0,
  checked_in_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_members_name_not_blank check (length(btrim(display_name)) > 0),
  constraint activity_members_level check (level between 1 and 18),
  constraint activity_members_source_order check (source_order >= 0),
  constraint activity_members_claim_consistency check (
    (claim_status = 'unclaimed' and claimed_at is null)
    or (claim_status = 'claimed' and claimed_at is not null)
  ),
  constraint activity_members_checkin_consistency check (
    (checkin_status = 'not_arrived' and checked_in_at is null)
    or checkin_status = 'checked_in'
  ),
  constraint activity_members_payment_consistency check (
    (payment_status = 'unpaid' and paid_at is null)
    or (payment_status = 'paid' and paid_at is not null and payment_method is not null)
  ),
  constraint activity_members_cancelled_not_playing check (
    registration_status <> 'cancelled' or attendance_state <> 'playing'
  )
);

create index activity_members_activity_order_idx
  on public.activity_members(activity_id, registration_status, source_order, created_at);
create index activity_members_activity_checkin_idx
  on public.activity_members(activity_id, checkin_status, payment_status);
create index activity_members_activity_plan_idx
  on public.activity_members(activity_id, plan_id);
create index activity_members_activity_name_idx
  on public.activity_members(activity_id, lower(display_name));

create table public.member_relationships (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_low_id uuid not null references public.activity_members(id) on delete cascade,
  member_high_id uuid not null references public.activity_members(id) on delete cascade,
  relationship_type public.relationship_type not null,
  consumed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (activity_id, member_low_id, member_high_id, relationship_type),
  constraint member_relationships_distinct check (member_low_id <> member_high_id),
  constraint member_relationships_canonical_order check (member_low_id < member_high_id)
);

create index member_relationships_activity_type_idx
  on public.member_relationships(activity_id, relationship_type, consumed_at);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  name text not null,
  sort_order smallint not null,
  status public.court_status not null default 'idle',
  active_match_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, sort_order),
  constraint courts_name_not_blank check (length(btrim(name)) > 0),
  constraint courts_sort_order check (sort_order >= 0)
);

create table public.preview_queues (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  sort_order smallint not null,
  source public.queue_source not null default 'system',
  manually_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, sort_order),
  constraint preview_queues_sort_order check (sort_order >= 0)
);

create table public.preview_queue_members (
  preview_queue_id uuid not null references public.preview_queues(id) on delete cascade,
  activity_member_id uuid not null references public.activity_members(id) on delete cascade,
  slot smallint not null,
  team char(1) not null,
  one_time_expired_override boolean not null default false,
  override_granted_by uuid references public.profiles(id) on delete set null,
  override_granted_at timestamptz,
  primary key (preview_queue_id, slot),
  unique (activity_member_id),
  constraint preview_queue_members_slot check (slot between 1 and 4),
  constraint preview_queue_members_team check (team in ('A', 'B')),
  constraint preview_queue_members_override check (
    not one_time_expired_override
    or (override_granted_by is not null and override_granted_at is not null)
  )
);

create index preview_queues_activity_order_idx
  on public.preview_queues(activity_id, sort_order);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete restrict,
  court_name_snapshot text not null,
  status public.match_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  score_a smallint,
  score_b smallint,
  result public.match_result not null default 'unrecorded',
  note text,
  assignment_source public.assignment_source not null,
  source_preview_id uuid references public.preview_queues(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_court_name_not_blank check (length(btrim(court_name_snapshot)) > 0),
  constraint matches_scores check (
    (score_a is null and score_b is null)
    or (score_a between 0 and 99 and score_b between 0 and 99)
  ),
  constraint matches_status_time check (
    (status = 'in_progress' and ended_at is null and cancelled_at is null)
    or (status = 'completed' and ended_at is not null and ended_at >= started_at and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  ),
  constraint matches_result_score_consistency check (
    score_a is null
    or result = 'unrecorded'
    or (score_a > score_b and result = 'team_a_win')
    or (score_b > score_a and result = 'team_b_win')
    or (score_a = score_b and result = 'no_result')
  )
);

create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  activity_member_id uuid not null references public.activity_members(id) on delete restrict,
  team char(1) not null,
  slot smallint not null,
  primary key (match_id, slot),
  unique (match_id, activity_member_id),
  constraint match_players_team check (team in ('A', 'B')),
  constraint match_players_slot check (slot between 1 and 4)
);

alter table public.courts
  add constraint courts_active_match_fk
  foreign key (active_match_id) references public.matches(id) on delete set null;

create unique index one_active_match_per_court
  on public.matches(court_id)
  where status = 'in_progress';
create index matches_activity_started_idx
  on public.matches(activity_id, started_at desc);
create index match_players_member_idx
  on public.match_players(activity_member_id, match_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  activity_member_id uuid not null references public.activity_members(id) on delete restrict,
  amount integer not null,
  method text not null,
  provider text,
  environment public.payment_environment,
  status public.transaction_status not null default 'pending',
  external_transaction_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount check (amount between 0 and 10000),
  constraint payments_method_not_blank check (length(btrim(method)) > 0),
  constraint payments_paid_consistency check (
    status <> 'paid' or paid_at is not null
  ),
  constraint payments_demo_consistency check (
    environment <> 'demo'
    or (provider = 'line_pay' and external_transaction_id like 'DEMO-%')
  )
);

create index payments_activity_status_idx
  on public.payments(activity_id, status, method);
create index payments_member_created_idx
  on public.payments(activity_member_id, created_at desc);

create table public.self_checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  token_hash text not null unique,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint self_checkin_sessions_token_hash_not_blank check (length(btrim(token_hash)) >= 32),
  constraint self_checkin_sessions_time check (closed_at is null or closed_at >= opened_at)
);

create unique index one_open_self_checkin_session_per_activity
  on public.self_checkin_sessions(activity_id)
  where closed_at is null;

alter table public.activity_members
  add constraint activity_members_claimed_session_fk
  foreign key (claimed_session_id) references public.self_checkin_sessions(id) on delete set null;

create table public.activity_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  config_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_templates_name_not_blank check (length(btrim(name)) > 0)
);

create index activity_templates_org_updated_idx
  on public.activity_templates(organization_id, updated_at desc);

-- Generic updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger organizer_venues_set_updated_at before update on public.organizer_venues
for each row execute function public.set_updated_at();
create trigger activities_set_updated_at before update on public.activities
for each row execute function public.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
for each row execute function public.set_updated_at();
create trigger activity_members_set_updated_at before update on public.activity_members
for each row execute function public.set_updated_at();
create trigger courts_set_updated_at before update on public.courts
for each row execute function public.set_updated_at();
create trigger preview_queues_set_updated_at before update on public.preview_queues
for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();
create trigger activity_templates_set_updated_at before update on public.activity_templates
for each row execute function public.set_updated_at();

-- Authorization helpers avoid recursive membership RLS checks.
create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.role = 'owner'
  );
$$;

create or replace function public.owns_activity(target_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.activities a
    join public.organization_memberships om
      on om.organization_id = a.organization_id
    where a.id = target_activity_id
      and om.user_id = auth.uid()
      and om.role = 'owner'
  );
$$;

create or replace function public.activity_for_plan(target_plan_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.activity_id from public.plans p where p.id = target_plan_id;
$$;

create or replace function public.activity_for_member(target_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.activity_id from public.activity_members m where m.id = target_member_id;
$$;

-- Keep V1's maximum of three non-archived activities per organization.
create or replace function public.enforce_unarchived_activity_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if new.status = 'archived' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));

  select count(*) into current_count
  from public.activities a
  where a.organization_id = new.organization_id
    and a.status <> 'archived'
    and a.id <> new.id;

  if current_count >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'UNARCHIVED_ACTIVITY_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

create trigger activities_enforce_limit
before insert or update of organization_id, status on public.activities
for each row execute function public.enforce_unarchived_activity_limit();

-- RLS activation.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organizer_venues enable row level security;
alter table public.activities enable row level security;
alter table public.plans enable row level security;
alter table public.activity_members enable row level security;
alter table public.member_relationships enable row level security;
alter table public.courts enable row level security;
alter table public.preview_queues enable row level security;
alter table public.preview_queue_members enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.payments enable row level security;
alter table public.self_checkin_sessions enable row level security;
alter table public.activity_templates enable row level security;

-- Profile policies.
create policy profiles_select_self on public.profiles
for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Organization and membership policies.
create policy organizations_owner_all on public.organizations
for all to authenticated
using (public.is_organization_owner(id))
with check (public.is_organization_owner(id));

create policy memberships_owner_select on public.organization_memberships
for select to authenticated
using (public.is_organization_owner(organization_id));

-- Organization-owned tables.
create policy organizer_venues_owner_all on public.organizer_venues
for all to authenticated
using (public.is_organization_owner(organization_id))
with check (public.is_organization_owner(organization_id));

create policy activities_owner_all on public.activities
for all to authenticated
using (public.is_organization_owner(organization_id))
with check (public.is_organization_owner(organization_id));

create policy activity_templates_owner_all on public.activity_templates
for all to authenticated
using (public.is_organization_owner(organization_id))
with check (public.is_organization_owner(organization_id));

-- Activity-owned tables.
create policy plans_owner_all on public.plans
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy activity_members_owner_all on public.activity_members
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy member_relationships_owner_all on public.member_relationships
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy courts_owner_all on public.courts
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy preview_queues_owner_all on public.preview_queues
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy matches_owner_all on public.matches
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy payments_owner_all on public.payments
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

create policy self_checkin_sessions_owner_all on public.self_checkin_sessions
for all to authenticated
using (public.owns_activity(activity_id))
with check (public.owns_activity(activity_id));

-- Join-table policies derive ownership through their parent.
create policy preview_queue_members_owner_all on public.preview_queue_members
for all to authenticated
using (
  exists (
    select 1 from public.preview_queues q
    where q.id = preview_queue_id and public.owns_activity(q.activity_id)
  )
)
with check (
  exists (
    select 1 from public.preview_queues q
    where q.id = preview_queue_id and public.owns_activity(q.activity_id)
  )
);

create policy match_players_owner_all on public.match_players
for all to authenticated
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and public.owns_activity(m.activity_id)
  )
)
with check (
  exists (
    select 1 from public.matches m
    where m.id = match_id and public.owns_activity(m.activity_id)
  )
);

-- No anon table policy is intentionally created. Public self-check-in goes
-- through narrowly scoped Edge Functions that validate a hashed session token.

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_unarchived_activity_limit() from public, anon, authenticated;
revoke execute on function public.is_organization_owner(uuid) from public, anon;
revoke execute on function public.owns_activity(uuid) from public, anon;
revoke execute on function public.activity_for_plan(uuid) from public, anon, authenticated;
revoke execute on function public.activity_for_member(uuid) from public, anon, authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant execute on function public.owns_activity(uuid) to authenticated;

-- Realtime publication is intentionally limited to tables needed by the live UI.
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.activity_members;
alter publication supabase_realtime add table public.courts;
alter publication supabase_realtime add table public.preview_queues;
alter publication supabase_realtime add table public.preview_queue_members;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_players;
alter publication supabase_realtime add table public.payments;
