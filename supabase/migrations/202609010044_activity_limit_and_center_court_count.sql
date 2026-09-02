-- Raise the organization activity limit and expose initial court count on the club home.
create or replace function public.enforce_unarchived_activity_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if new.status = 'archived' then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));

  select count(*) into current_count
  from public.activities a
  where a.organization_id = new.organization_id
    and a.status <> 'archived'
    and a.id <> new.id;

  if current_count >= 5 then
    raise exception using errcode = 'P0001', message = 'UNARCHIVED_ACTIVITY_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

create or replace function public.get_activity_center_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_organization_id uuid;
  owner_organization_name text;
  account_name_value text;
  display_name_value text;
  activity_items jsonb;
  unarchived_count_value integer;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;

  select p.username_normalized, p.display_name into account_name_value, display_name_value
  from public.profiles p where p.id = auth.uid();

  select o.id, o.name into owner_organization_id, owner_organization_name
  from public.organization_memberships om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid() and om.role = 'owner';

  if owner_organization_id is null then raise exception using errcode = '42501', message = 'OWNER_ORGANIZATION_NOT_FOUND'; end if;

  select count(*) into unarchived_count_value
  from public.activities a where a.organization_id = owner_organization_id and a.status <> 'archived';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'activity_date', a.activity_date,
    'scheduled_start_at', a.scheduled_start_at,
    'scheduled_end_at', a.scheduled_end_at,
    'custom_title', a.custom_title,
    'venue_snapshot', a.venue_snapshot,
    'initial_court_count', a.initial_court_count,
    'capacity_mode', a.capacity_mode,
    'capacity_limit', a.capacity_limit,
    'status', a.status,
    'archived_at', a.archived_at,
    'active_member_count', (select count(*) from public.activity_members am where am.activity_id = a.id and am.registration_status = 'active')
  ) order by
    case a.status when 'in_progress' then 0 when 'scheduled' then 1 when 'draft' then 2 when 'ended' then 3 else 4 end,
    case when a.status in ('in_progress', 'scheduled', 'draft') then a.activity_date end asc,
    case when a.status = 'ended' then a.activity_date end desc,
    a.archived_at desc nulls last
  ), '[]'::jsonb) into activity_items
  from public.activities a where a.organization_id = owner_organization_id;

  return jsonb_build_object(
    'organization_id', owner_organization_id,
    'organization_name', owner_organization_name,
    'account_name', account_name_value,
    'display_name', display_name_value,
    'unarchived_count', unarchived_count_value,
    'activities', activity_items
  );
end;
$$;

revoke all on function public.get_activity_center_v1() from public;
grant execute on function public.get_activity_center_v1() to authenticated;
