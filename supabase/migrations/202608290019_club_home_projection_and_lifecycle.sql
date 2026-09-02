-- Club home projection, including archived activities and lifecycle actions.
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

create or replace function public.manage_activity_lifecycle_v1(target_activity_id uuid, target_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
begin
  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';

  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;

  if target_action = 'archive' then
    if activity_row.status <> 'ended' then raise exception using errcode = '22023', message = 'ONLY_ENDED_ACTIVITY_CAN_BE_ARCHIVED'; end if;
    update public.activities set status = 'archived', archived_at = now(), updated_at = now() where id = target_activity_id;
  elsif target_action = 'unarchive' then
    if activity_row.status <> 'archived' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_ARCHIVED'; end if;
    update public.activities set status = 'ended', archived_at = null, updated_at = now() where id = target_activity_id;
  elsif target_action = 'delete' then
    if activity_row.status not in ('draft', 'archived') then raise exception using errcode = '22023', message = 'ACTIVITY_DELETE_NOT_ALLOWED'; end if;
    delete from public.activities where id = target_activity_id;
  else
    raise exception using errcode = '22023', message = 'ACTIVITY_ACTION_INVALID';
  end if;
end;
$$;

revoke all on function public.get_activity_center_v1() from public;
revoke all on function public.manage_activity_lifecycle_v1(uuid, text) from public;
grant execute on function public.get_activity_center_v1() to authenticated;
grant execute on function public.manage_activity_lifecycle_v1(uuid, text) to authenticated;
