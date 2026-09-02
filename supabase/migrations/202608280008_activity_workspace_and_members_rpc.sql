-- Activity workspace projection and the first member-management transaction.

create or replace function public.get_activity_workspace_v1(target_activity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
  organization_name_value text;
  plan_items jsonb;
  member_items jsonb;
  stats_value jsonb;
begin
  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';

  if activity_row.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;

  select o.name into organization_name_value
  from public.organizations o
  where o.id = activity_row.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'code', p.code, 'start_at', p.start_at, 'end_at', p.end_at, 'amount', p.amount
  ) order by p.code), '[]'::jsonb)
  into plan_items
  from public.plans p where p.activity_id = target_activity_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', am.id,
    'display_name', am.display_name,
    'disambiguation_label', am.disambiguation_label,
    'gender', am.gender,
    'level', am.level,
    'plan_id', am.plan_id,
    'checkin_status', am.checkin_status,
    'attendance_state', am.attendance_state,
    'registration_status', am.registration_status,
    'payment_status', am.payment_status,
    'payment_method', am.payment_method,
    'note', am.note,
    'source', am.source
  ) order by am.registration_status, am.source_order, am.created_at), '[]'::jsonb)
  into member_items
  from public.activity_members am where am.activity_id = target_activity_id;

  select jsonb_build_object(
    'active_members', count(*) filter (where am.registration_status = 'active'),
    'checked_in', count(*) filter (where am.registration_status = 'active' and am.checkin_status = 'checked_in'),
    'not_arrived', count(*) filter (where am.registration_status = 'active' and am.checkin_status = 'not_arrived'),
    'paid', count(*) filter (where am.registration_status = 'active' and am.payment_status = 'paid'),
    'unpaid', count(*) filter (where am.registration_status = 'active' and am.payment_status = 'unpaid'),
    'expected_amount', coalesce(sum(p.amount) filter (
      where am.registration_status = 'active'
        and coalesce(am.no_show_status::text, '') not in ('waived', 'cancelled')
    ), 0),
    'collected_amount', coalesce(sum(pay.amount) filter (where pay.status = 'paid'), 0)
  ) into stats_value
  from public.activity_members am
  left join public.plans p on p.id = am.plan_id
  left join lateral (
    select coalesce(sum(payment.amount), 0)::integer as amount, 'paid'::text as status
    from public.payments payment
    where payment.activity_member_id = am.id and payment.status = 'paid'
  ) pay on true
  where am.activity_id = target_activity_id;

  return jsonb_build_object(
    'organization_name', organization_name_value,
    'activity', jsonb_build_object(
      'id', activity_row.id,
      'custom_title', activity_row.custom_title,
      'status', activity_row.status,
      'activity_date', activity_row.activity_date,
      'scheduled_start_at', activity_row.scheduled_start_at,
      'scheduled_end_at', activity_row.scheduled_end_at,
      'venue_snapshot', activity_row.venue_snapshot,
      'capacity_mode', activity_row.capacity_mode,
      'capacity_limit', activity_row.capacity_limit,
      'skill_min', activity_row.skill_min,
      'skill_max', activity_row.skill_max,
      'finance_enabled', activity_row.finance_enabled,
      'assign_mode', activity_row.assign_mode
    ),
    'plans', plan_items,
    'members', member_items,
    'stats', stats_value
  );
end;
$$;

create or replace function public.add_activity_member_v1(
  target_activity_id uuid,
  target_display_name text,
  target_level smallint,
  target_plan_id uuid,
  target_gender text default null,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
  new_member_id uuid;
  active_member_count integer;
  next_source_order integer;
  warning_items jsonb := '[]'::jsonb;
begin
  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';

  if activity_row.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  if activity_row.status not in ('scheduled', 'in_progress') then
    raise exception using errcode = '22023', message = 'ACTIVITY_NOT_ACCEPTING_MEMBERS';
  end if;
  if nullif(btrim(target_display_name), '') is null then
    raise exception using errcode = '22023', message = 'MEMBER_NAME_REQUIRED';
  end if;
  if target_level < 1 or target_level > 18 then
    raise exception using errcode = '22023', message = 'MEMBER_LEVEL_INVALID';
  end if;
  if target_gender is not null and target_gender not in ('M', 'F') then
    raise exception using errcode = '22023', message = 'MEMBER_GENDER_INVALID';
  end if;
  if not exists (
    select 1 from public.plans p where p.id = target_plan_id and p.activity_id = target_activity_id
  ) then
    raise exception using errcode = '22023', message = 'MEMBER_PLAN_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 1));
  select count(*), coalesce(max(am.source_order), -1) + 1
  into active_member_count, next_source_order
  from public.activity_members am
  where am.activity_id = target_activity_id and am.registration_status = 'active';

  if activity_row.capacity_mode = 'limited' and active_member_count >= activity_row.capacity_limit then
    warning_items := warning_items || '"CAPACITY_EXCEEDED"'::jsonb;
  end if;
  if target_level < activity_row.skill_min or target_level > activity_row.skill_max then
    warning_items := warning_items || '"LEVEL_OUTSIDE_ACTIVITY_RANGE"'::jsonb;
  end if;

  insert into public.activity_members (
    activity_id, display_name, gender, level, plan_id, note, source, source_order
  ) values (
    target_activity_id,
    btrim(target_display_name),
    target_gender::public.member_gender,
    target_level,
    target_plan_id,
    nullif(btrim(target_note), ''),
    'manual',
    next_source_order
  ) returning id into new_member_id;

  return jsonb_build_object('member_id', new_member_id, 'warnings', warning_items);
end;
$$;

revoke all on function public.get_activity_workspace_v1(uuid) from public;
revoke all on function public.add_activity_member_v1(uuid, text, smallint, uuid, text, text) from public;
grant execute on function public.get_activity_workspace_v1(uuid) to authenticated;
grant execute on function public.add_activity_member_v1(uuid, text, smallint, uuid, text, text) to authenticated;
