-- Include the signed-in username in the shared navigation projection.

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
  activity_items jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select p.username_normalized into account_name_value
  from public.profiles p where p.id = auth.uid();

  select o.id, o.name
  into owner_organization_id, owner_organization_name
  from public.organization_memberships om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid() and om.role = 'owner';

  if owner_organization_id is null then
    raise exception using errcode = '42501', message = 'OWNER_ORGANIZATION_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'activity_date', a.activity_date,
    'scheduled_start_at', a.scheduled_start_at,
    'scheduled_end_at', a.scheduled_end_at,
    'venue_snapshot', a.venue_snapshot,
    'capacity_mode', a.capacity_mode,
    'capacity_limit', a.capacity_limit,
    'status', a.status,
    'active_member_count', (
      select count(*) from public.activity_members am
      where am.activity_id = a.id and am.registration_status = 'active'
    )
  ) order by a.activity_date, a.scheduled_start_at nulls last), '[]'::jsonb)
  into activity_items
  from public.activities a
  where a.organization_id = owner_organization_id and a.status <> 'archived';

  return jsonb_build_object(
    'organization_id', owner_organization_id,
    'organization_name', owner_organization_name,
    'account_name', account_name_value,
    'activities', activity_items
  );
end;
$$;

revoke all on function public.get_activity_center_v1() from public;
grant execute on function public.get_activity_center_v1() to authenticated;
