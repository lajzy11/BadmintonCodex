-- Atomically creates an activity with plans, initial courts, preview queue,
-- optional private venue and optional reusable template.

create or replace function public.create_activity_v1(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_organization_id uuid;
  new_activity_id uuid;
  plan_count integer;
  earliest_plan_start timestamptz;
  latest_plan_end timestamptz;
  finance_enabled_value boolean := coalesce((payload->>'finance_enabled')::boolean, true);
  capacity_mode_value public.capacity_mode := coalesce((payload->>'capacity_mode')::public.capacity_mode, 'limited');
  payment_methods_value text[];
  venue_value jsonb := payload->'venue';
  initial_courts integer := coalesce((payload->>'initial_court_count')::integer, 1);
begin
  select om.organization_id into owner_organization_id
  from public.organization_memberships om
  where om.user_id = auth.uid() and om.role = 'owner';

  if owner_organization_id is null then
    raise exception using errcode = '42501', message = 'OWNER_ORGANIZATION_NOT_FOUND';
  end if;

  if jsonb_typeof(payload->'plans') <> 'array' then
    raise exception using errcode = '22023', message = 'PLANS_REQUIRED';
  end if;
  plan_count := jsonb_array_length(payload->'plans');
  if plan_count < 1 or plan_count > 5 then
    raise exception using errcode = '22023', message = 'PLAN_COUNT_INVALID';
  end if;

  if initial_courts < 1 or initial_courts > 20 then
    raise exception using errcode = '22023', message = 'INITIAL_COURT_COUNT_INVALID';
  end if;

  if venue_value is null
    or nullif(btrim(venue_value->>'name'), '') is null
    or nullif(btrim(venue_value->>'region'), '') is null
    or nullif(btrim(venue_value->>'district'), '') is null then
    raise exception using errcode = '22023', message = 'VENUE_REQUIRED';
  end if;

  select min((plan->>'start_at')::timestamptz), max((plan->>'end_at')::timestamptz)
  into earliest_plan_start, latest_plan_end
  from jsonb_array_elements(payload->'plans') plan;

  if earliest_plan_start is null or latest_plan_end is null or exists (
    select 1 from jsonb_array_elements(payload->'plans') plan
    where (plan->>'end_at')::timestamptz <= (plan->>'start_at')::timestamptz
  ) then
    raise exception using errcode = '22023', message = 'PLAN_TIME_INVALID';
  end if;

  if finance_enabled_value and exists (
    select 1 from jsonb_array_elements(payload->'plans') plan
    where plan->>'amount' is null
      or (plan->>'amount')::integer < 0
      or (plan->>'amount')::integer > 10000
  ) then
    raise exception using errcode = '22023', message = 'PLAN_AMOUNT_REQUIRED';
  end if;

  select coalesce(array_agg(value), array[]::text[]) into payment_methods_value
  from jsonb_array_elements_text(coalesce(payload->'enabled_payment_methods', '[]'::jsonb));

  if finance_enabled_value and cardinality(payment_methods_value) = 0 then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_REQUIRED';
  end if;

  if coalesce((payload->>'save_venue')::boolean, true) then
    insert into public.organizer_venues (
      organization_id, name, region, district, address, floor_type, note
    ) values (
      owner_organization_id,
      btrim(venue_value->>'name'),
      btrim(venue_value->>'region'),
      btrim(venue_value->>'district'),
      nullif(btrim(venue_value->>'address'), ''),
      nullif(btrim(venue_value->>'floor_type'), ''),
      nullif(btrim(venue_value->>'note'), '')
    );
  end if;

  insert into public.activities (
    organization_id,
    custom_title,
    status,
    activity_date,
    scheduled_start_at,
    scheduled_end_at,
    venue_snapshot,
    initial_court_count,
    capacity_mode,
    capacity_limit,
    skill_min,
    skill_max,
    assign_mode,
    finance_enabled,
    enabled_payment_methods,
    default_payment_method,
    auto_time_eligibility_enabled,
    matching_settings,
    tts_settings,
    shuttlecock,
    contact_info,
    description
  ) values (
    owner_organization_id,
    nullif(btrim(payload->>'custom_title'), ''),
    case when earliest_plan_start <= now() then 'in_progress'::public.activity_status else 'scheduled'::public.activity_status end,
    (payload->>'activity_date')::date,
    earliest_plan_start,
    latest_plan_end,
    venue_value,
    initial_courts,
    capacity_mode_value,
    case when capacity_mode_value = 'limited' then (payload->>'capacity_limit')::integer else null end,
    (payload->>'skill_min')::integer,
    (payload->>'skill_max')::integer,
    coalesce((payload->>'assign_mode')::public.assign_mode, 'system_assign'),
    finance_enabled_value,
    case when finance_enabled_value then payment_methods_value else array[]::text[] end,
    case when finance_enabled_value then nullif(payload->>'default_payment_method', '') else null end,
    coalesce((payload->>'auto_time_eligibility_enabled')::boolean, true),
    coalesce(payload->'matching_settings', '{"priority":"balanced","levelMatch":"balanced","repeatAvoidance":"moderate","genderPreference":"none"}'::jsonb),
    coalesce(payload->'tts_settings', '{"enabled":true,"repeatCount":2,"rate":1.0}'::jsonb),
    nullif(btrim(payload->>'shuttlecock'), ''),
    nullif(btrim(payload->>'contact_info'), ''),
    nullif(btrim(payload->>'description'), '')
  ) returning id into new_activity_id;

  insert into public.plans (activity_id, code, start_at, end_at, amount)
  select
    new_activity_id,
    (plan->>'code')::char(1),
    (plan->>'start_at')::timestamptz,
    (plan->>'end_at')::timestamptz,
    case when finance_enabled_value then (plan->>'amount')::integer else null end
  from jsonb_array_elements(payload->'plans') plan;

  insert into public.courts (activity_id, name, sort_order)
  select new_activity_id, '球場 ' || sequence_number, sequence_number - 1
  from generate_series(1, initial_courts) sequence_number;

  insert into public.preview_queues (activity_id, sort_order, source)
  values (new_activity_id, 0, 'system');

  if coalesce((payload->>'save_as_template')::boolean, false) then
    insert into public.activity_templates (organization_id, name, config_snapshot)
    values (
      owner_organization_id,
      coalesce(nullif(btrim(payload->>'template_name'), ''), nullif(btrim(payload->>'custom_title'), ''), venue_value->>'name'),
      payload - 'activity_date' - 'save_as_template' - 'template_name'
    );
  end if;

  return new_activity_id;
end;
$$;

revoke all on function public.create_activity_v1(jsonb) from public;
grant execute on function public.create_activity_v1(jsonb) to authenticated;
