-- Organizer-only projection for generating reusable promotional copy.

create or replace function public.get_activity_share_data_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare activity_row public.activities%rowtype;
declare organization_name_value text;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  select o.name into organization_name_value from public.organizations o where o.id = activity_row.organization_id;

  return jsonb_build_object(
    'organization_name', organization_name_value,
    'custom_title', activity_row.custom_title,
    'activity_date', activity_row.activity_date,
    'scheduled_start_at', activity_row.scheduled_start_at,
    'scheduled_end_at', activity_row.scheduled_end_at,
    'venue', activity_row.venue_snapshot,
    'capacity_mode', activity_row.capacity_mode,
    'capacity_limit', activity_row.capacity_limit,
    'skill_min', activity_row.skill_min,
    'skill_max', activity_row.skill_max,
    'contact_info', activity_row.contact_info,
    'shuttlecock', activity_row.shuttlecock,
    'description', activity_row.description,
    'plans', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'start_at', p.start_at, 'end_at', p.end_at, 'amount', p.amount) order by p.code) from public.plans p where p.activity_id = target_activity_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_activity_share_data_v1(uuid) from public;
grant execute on function public.get_activity_share_data_v1(uuid) to authenticated;
