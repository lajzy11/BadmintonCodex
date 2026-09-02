-- Read projections used by the activity creation wizard.

create or replace function public.get_organizer_venues_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'region', v.region,
        'district', v.district,
        'address', v.address,
        'floor_type', v.floor_type,
        'note', v.note
      ) order by v.last_used_at desc nulls last, v.updated_at desc
    ),
    '[]'::jsonb
  )
  from public.organizer_venues v
  join public.organization_memberships om on om.organization_id = v.organization_id
  where om.user_id = auth.uid() and om.role = 'owner';
$$;

create or replace function public.get_activity_copy_source_v1(source_activity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_activity public.activities%rowtype;
  copied_date date;
  copied_plans jsonb;
begin
  select a.* into source_activity
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = source_activity_id
    and om.user_id = auth.uid()
    and om.role = 'owner'
    and a.status <> 'draft';

  if source_activity.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_COPY_SOURCE_NOT_FOUND';
  end if;

  copied_date := greatest(
    source_activity.activity_date + 7,
    (now() at time zone 'Asia/Taipei')::date
  );

  select jsonb_agg(
    jsonb_build_object(
      'code', p.code,
      'start_at', p.start_at,
      'end_at', p.end_at,
      'amount', p.amount
    ) order by p.code
  ) into copied_plans
  from public.plans p
  where p.activity_id = source_activity.id;

  return jsonb_build_object(
    'activity_date', copied_date,
    'venue', source_activity.venue_snapshot,
    'initial_court_count', source_activity.initial_court_count,
    'capacity_mode', source_activity.capacity_mode,
    'capacity_limit', source_activity.capacity_limit,
    'skill_min', source_activity.skill_min,
    'skill_max', source_activity.skill_max,
    'assign_mode', source_activity.assign_mode,
    'custom_title', source_activity.custom_title,
    'shuttlecock', source_activity.shuttlecock,
    'contact_info', source_activity.contact_info,
    'description', source_activity.description,
    'plans', coalesce(copied_plans, '[]'::jsonb),
    'finance_enabled', source_activity.finance_enabled,
    'enabled_payment_methods', to_jsonb(source_activity.enabled_payment_methods),
    'default_payment_method', source_activity.default_payment_method,
    'auto_time_eligibility_enabled', source_activity.auto_time_eligibility_enabled,
    'matching_settings', source_activity.matching_settings,
    'tts_settings', source_activity.tts_settings
  );
end;
$$;

revoke all on function public.get_organizer_venues_v1() from public;
revoke all on function public.get_activity_copy_source_v1(uuid) from public;
grant execute on function public.get_organizer_venues_v1() to authenticated;
grant execute on function public.get_activity_copy_source_v1(uuid) to authenticated;
