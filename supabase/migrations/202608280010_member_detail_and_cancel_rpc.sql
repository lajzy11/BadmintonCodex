-- Single-member detail maintenance, avoid-same-match relationships and cancel.

create or replace function public.get_activity_member_detail_v1(target_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member_row public.activity_members%rowtype;
  avoid_ids jsonb;
begin
  select am.* into member_row
  from public.activity_members am
  join public.activities a on a.id = am.activity_id
  join public.organization_memberships om on om.organization_id = a.organization_id
  where am.id = target_member_id and om.user_id = auth.uid() and om.role = 'owner';

  if member_row.id is null then
    raise exception using errcode = '42501', message = 'MEMBER_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(
    case when mr.member_low_id = target_member_id then mr.member_high_id else mr.member_low_id end
  ), '[]'::jsonb)
  into avoid_ids
  from public.member_relationships mr
  where mr.activity_id = member_row.activity_id
    and mr.relationship_type = 'avoid_same_match'
    and (mr.member_low_id = target_member_id or mr.member_high_id = target_member_id);

  return jsonb_build_object(
    'id', member_row.id,
    'activity_id', member_row.activity_id,
    'display_name', member_row.display_name,
    'gender', member_row.gender,
    'level', member_row.level,
    'plan_id', member_row.plan_id,
    'note', member_row.note,
    'checkin_status', member_row.checkin_status,
    'payment_status', member_row.payment_status,
    'attendance_state', member_row.attendance_state,
    'registration_status', member_row.registration_status,
    'avoid_member_ids', avoid_ids
  );
end;
$$;

create or replace function public.update_activity_member_v1(
  target_member_id uuid,
  target_display_name text,
  target_level smallint,
  target_plan_id uuid,
  target_gender text default null,
  target_note text default null,
  target_avoid_member_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.activity_members%rowtype;
  requested_avoid_count integer;
  valid_avoid_count integer;
  warning_items jsonb := '[]'::jsonb;
  activity_skill_min smallint;
  activity_skill_max smallint;
begin
  select am.* into member_row
  from public.activity_members am
  join public.activities a on a.id = am.activity_id
  join public.organization_memberships om on om.organization_id = a.organization_id
  where am.id = target_member_id and om.user_id = auth.uid() and om.role = 'owner';

  if member_row.id is null or member_row.registration_status <> 'active' then
    raise exception using errcode = '42501', message = 'ACTIVE_MEMBER_NOT_FOUND';
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
    select 1 from public.plans p where p.id = target_plan_id and p.activity_id = member_row.activity_id
  ) then
    raise exception using errcode = '22023', message = 'MEMBER_PLAN_INVALID';
  end if;

  target_avoid_member_ids := coalesce(target_avoid_member_ids, array[]::uuid[]);
  requested_avoid_count := cardinality(target_avoid_member_ids);
  if target_member_id = any(target_avoid_member_ids)
    or (select count(distinct selected.member_id) from unnest(target_avoid_member_ids) as selected(member_id)) <> requested_avoid_count then
    raise exception using errcode = '22023', message = 'AVOID_MEMBER_SELECTION_INVALID';
  end if;

  select count(*) into valid_avoid_count
  from public.activity_members am
  where am.activity_id = member_row.activity_id
    and am.registration_status = 'active'
    and am.id = any(target_avoid_member_ids);
  if valid_avoid_count <> requested_avoid_count then
    raise exception using errcode = '22023', message = 'AVOID_MEMBER_SELECTION_STALE';
  end if;

  select a.skill_min, a.skill_max into activity_skill_min, activity_skill_max
  from public.activities a where a.id = member_row.activity_id;
  if target_level < activity_skill_min or target_level > activity_skill_max then
    warning_items := warning_items || '"LEVEL_OUTSIDE_ACTIVITY_RANGE"'::jsonb;
  end if;

  update public.activity_members
  set display_name = btrim(target_display_name),
      level = target_level,
      plan_id = target_plan_id,
      gender = target_gender::public.member_gender,
      note = nullif(btrim(target_note), '')
  where id = target_member_id;

  delete from public.member_relationships mr
  where mr.activity_id = member_row.activity_id
    and mr.relationship_type = 'avoid_same_match'
    and (mr.member_low_id = target_member_id or mr.member_high_id = target_member_id);

  insert into public.member_relationships (
    activity_id, member_low_id, member_high_id, relationship_type, created_by
  )
  select
    member_row.activity_id,
    case when target_member_id < selected.member_id then target_member_id else selected.member_id end,
    case when target_member_id < selected.member_id then selected.member_id else target_member_id end,
    'avoid_same_match',
    auth.uid()
  from unnest(target_avoid_member_ids) as selected(member_id)
  on conflict (activity_id, member_low_id, member_high_id, relationship_type) do nothing;

  return jsonb_build_object('member_id', target_member_id, 'warnings', warning_items);
end;
$$;

create or replace function public.cancel_activity_member_v1(target_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.activity_members%rowtype;
  removed_from_preview boolean := false;
begin
  select am.* into member_row
  from public.activity_members am
  join public.activities a on a.id = am.activity_id
  join public.organization_memberships om on om.organization_id = a.organization_id
  where am.id = target_member_id and om.user_id = auth.uid() and om.role = 'owner';

  if member_row.id is null or member_row.registration_status <> 'active' then
    raise exception using errcode = '42501', message = 'ACTIVE_MEMBER_NOT_FOUND';
  end if;
  if member_row.attendance_state = 'playing' or exists (
    select 1
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where mp.activity_member_id = target_member_id and m.status = 'in_progress'
  ) then
    raise exception using errcode = '22023', message = 'MEMBER_CURRENTLY_PLAYING';
  end if;

  delete from public.preview_queue_members pqm
  where pqm.activity_member_id = target_member_id;
  removed_from_preview := found;

  update public.activity_members
  set registration_status = 'cancelled', attendance_state = 'idle'
  where id = target_member_id;

  return jsonb_build_object('member_id', target_member_id, 'removed_from_preview', removed_from_preview);
end;
$$;

revoke all on function public.get_activity_member_detail_v1(uuid) from public;
revoke all on function public.update_activity_member_v1(uuid, text, smallint, uuid, text, text, uuid[]) from public;
revoke all on function public.cancel_activity_member_v1(uuid) from public;
grant execute on function public.get_activity_member_detail_v1(uuid) to authenticated;
grant execute on function public.update_activity_member_v1(uuid, text, smallint, uuid, text, text, uuid[]) to authenticated;
grant execute on function public.cancel_activity_member_v1(uuid) to authenticated;
