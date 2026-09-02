-- First dispatching slice: state projection, resource counts, manual preview
-- assignment and starting a match. All multi-table changes are transactional.

alter table public.courts
  add column is_active boolean not null default true;

create or replace function public.get_dispatch_state_v1(target_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
  court_items jsonb;
  queue_items jsonb;
  eligible_items jsonb;
begin
  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;

  if activity_row.status = 'scheduled' and exists (
    select 1 from public.plans p where p.activity_id = target_activity_id and p.start_at <= now()
  ) then
    update public.activities set status = 'in_progress' where id = target_activity_id;
    activity_row.status := 'in_progress';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'sort_order', c.sort_order,
    'status', c.status,
    'active_match_id', c.active_match_id,
    'started_at', m.started_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', mp.activity_member_id,
        'display_name', am.display_name,
        'team', mp.team,
        'slot', mp.slot
      ) order by mp.slot)
      from public.match_players mp
      join public.activity_members am on am.id = mp.activity_member_id
      where mp.match_id = c.active_match_id
    ), '[]'::jsonb)
  ) order by c.sort_order), '[]'::jsonb)
  into court_items
  from public.courts c
  left join public.matches m on m.id = c.active_match_id
  where c.activity_id = target_activity_id and c.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'sort_order', q.sort_order,
    'source', q.source,
    'manually_edited', q.manually_edited,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', qm.activity_member_id,
        'display_name', am.display_name,
        'level', am.level,
        'slot', qm.slot,
        'team', qm.team,
        'one_time_expired_override', qm.one_time_expired_override
      ) order by qm.slot)
      from public.preview_queue_members qm
      join public.activity_members am on am.id = qm.activity_member_id
      where qm.preview_queue_id = q.id
    ), '[]'::jsonb)
  ) order by q.sort_order), '[]'::jsonb)
  into queue_items
  from public.preview_queues q
  where q.activity_id = target_activity_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', am.id,
    'display_name', am.display_name,
    'level', am.level,
    'gender', am.gender,
    'plan_code', p.code,
    'plan_start_at', p.start_at,
    'plan_end_at', p.end_at,
    'checked_in_at', am.checked_in_at
  ) order by am.checked_in_at nulls last, am.source_order), '[]'::jsonb)
  into eligible_items
  from public.activity_members am
  join public.plans p on p.id = am.plan_id
  where am.activity_id = target_activity_id
    and am.registration_status = 'active'
    and am.checkin_status = 'checked_in'
    and am.attendance_state = 'idle'
    and not exists (
      select 1 from public.preview_queue_members qm where qm.activity_member_id = am.id
    )
    and (
      not activity_row.auto_time_eligibility_enabled
      or (p.start_at <= now() and p.end_at > now())
    );

  return jsonb_build_object(
    'activity_id', activity_row.id,
    'status', activity_row.status,
    'assign_mode', activity_row.assign_mode,
    'courts', court_items,
    'queues', queue_items,
    'eligible_members', eligible_items
  );
end;
$$;

create or replace function public.adjust_dispatch_resource_v1(
  target_activity_id uuid,
  resource_type text,
  adjustment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_status_value public.activity_status;
  new_id uuid;
  target_id uuid;
  next_order integer;
  current_count integer;
begin
  select a.status into activity_status_value
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_status_value is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  if activity_status_value in ('ended', 'archived') then
    raise exception using errcode = '22023', message = 'ACTIVITY_ALREADY_ENDED';
  end if;
  if resource_type not in ('court', 'queue') or adjustment not in ('add', 'remove') then
    raise exception using errcode = '22023', message = 'RESOURCE_ADJUSTMENT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text || resource_type, 4));
  if resource_type = 'court' then
    select count(*) filter (where c.is_active), coalesce(max(c.sort_order), -1) + 1 into current_count, next_order
    from public.courts c where c.activity_id = target_activity_id;
    if adjustment = 'add' then
      if current_count >= 20 then raise exception using errcode = '22023', message = 'COURT_LIMIT_REACHED'; end if;
      insert into public.courts (activity_id, name, sort_order)
      values (target_activity_id, '球場 ' || (next_order + 1), next_order) returning id into new_id;
    else
      if current_count <= 1 then raise exception using errcode = '22023', message = 'COURT_MINIMUM_REACHED'; end if;
      select c.id into target_id from public.courts c
      where c.activity_id = target_activity_id and c.is_active and c.status = 'idle' and c.active_match_id is null
      order by c.sort_order desc limit 1;
      if target_id is null then raise exception using errcode = '22023', message = 'NO_REMOVABLE_COURT'; end if;
      update public.courts set is_active = false where id = target_id;
    end if;
  else
    select count(*), coalesce(max(q.sort_order), -1) + 1 into current_count, next_order
    from public.preview_queues q where q.activity_id = target_activity_id;
    if adjustment = 'add' then
      if current_count >= 10 then raise exception using errcode = '22023', message = 'QUEUE_LIMIT_REACHED'; end if;
      insert into public.preview_queues (activity_id, sort_order, source)
      values (target_activity_id, next_order, 'manual') returning id into new_id;
    else
      if current_count <= 1 then raise exception using errcode = '22023', message = 'QUEUE_MINIMUM_REACHED'; end if;
      select q.id into target_id from public.preview_queues q
      where q.activity_id = target_activity_id
        and not exists (select 1 from public.preview_queue_members qm where qm.preview_queue_id = q.id)
      order by q.sort_order desc limit 1;
      if target_id is null then raise exception using errcode = '22023', message = 'NO_REMOVABLE_QUEUE'; end if;
      delete from public.preview_queues where id = target_id;
    end if;
  end if;
  return jsonb_build_object('resource_type', resource_type, 'adjustment', adjustment, 'id', coalesce(new_id, target_id));
end;
$$;

create or replace function public.assign_members_to_preview_v1(
  target_activity_id uuid,
  target_queue_id uuid,
  target_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_count integer := cardinality(target_member_ids);
  existing_count integer;
  valid_count integer;
  activity_row public.activities%rowtype;
begin
  if selected_count is null or selected_count < 1 or selected_count > 4
    or (select count(distinct selected.member_id) from unnest(target_member_ids) as selected(member_id)) <> selected_count then
    raise exception using errcode = '22023', message = 'PREVIEW_SELECTION_INVALID';
  end if;
  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status <> 'in_progress' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_IN_PROGRESS'; end if;
  if not exists (select 1 from public.preview_queues q where q.id = target_queue_id and q.activity_id = target_activity_id) then
    raise exception using errcode = '22023', message = 'PREVIEW_QUEUE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 5));
  select count(*) into existing_count from public.preview_queue_members qm where qm.preview_queue_id = target_queue_id;
  if existing_count + selected_count > 4 then raise exception using errcode = '22023', message = 'PREVIEW_QUEUE_FULL'; end if;

  select count(*) into valid_count
  from public.activity_members am
  join public.plans p on p.id = am.plan_id
  where am.activity_id = target_activity_id
    and am.id = any(target_member_ids)
    and am.registration_status = 'active'
    and am.checkin_status = 'checked_in'
    and am.attendance_state = 'idle'
    and not exists (select 1 from public.preview_queue_members qm where qm.activity_member_id = am.id)
    and (not activity_row.auto_time_eligibility_enabled or (p.start_at <= now() and p.end_at > now()));
  if valid_count <> selected_count then raise exception using errcode = '22023', message = 'PREVIEW_MEMBER_NOT_ELIGIBLE'; end if;

  insert into public.preview_queue_members (preview_queue_id, activity_member_id, slot, team)
  select target_queue_id, selected.member_id, (existing_count + selected.ordinality)::smallint,
    case when existing_count + selected.ordinality <= 2 then 'A' else 'B' end
  from unnest(target_member_ids) with ordinality as selected(member_id, ordinality);
  update public.preview_queues set manually_edited = true, source = 'manual' where id = target_queue_id;
  return jsonb_build_object('queue_id', target_queue_id, 'member_count', existing_count + selected_count);
end;
$$;

create or replace function public.start_match_from_preview_v1(
  target_activity_id uuid,
  target_queue_id uuid,
  target_court_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_match_id uuid;
  court_name_value text;
  member_count integer;
  activity_status_value public.activity_status;
begin
  select a.status into activity_status_value
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_status_value is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_status_value <> 'in_progress' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_IN_PROGRESS'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 6));
  select c.name into court_name_value from public.courts c
  where c.id = target_court_id and c.activity_id = target_activity_id and c.is_active and c.status = 'idle' and c.active_match_id is null
  for update;
  if court_name_value is null then raise exception using errcode = '22023', message = 'COURT_NOT_AVAILABLE'; end if;
  if not exists (select 1 from public.preview_queues q where q.id = target_queue_id and q.activity_id = target_activity_id) then
    raise exception using errcode = '22023', message = 'PREVIEW_QUEUE_NOT_FOUND';
  end if;
  select count(*) into member_count from public.preview_queue_members qm where qm.preview_queue_id = target_queue_id;
  if member_count <> 4 then raise exception using errcode = '22023', message = 'PREVIEW_REQUIRES_FOUR_MEMBERS'; end if;
  if exists (
    select 1
    from public.preview_queue_members qm
    join public.activity_members am on am.id = qm.activity_member_id
    join public.plans p on p.id = am.plan_id
    join public.activities a on a.id = am.activity_id
    where qm.preview_queue_id = target_queue_id
      and (
        am.registration_status <> 'active'
        or am.checkin_status <> 'checked_in'
        or am.attendance_state <> 'idle'
        or (a.auto_time_eligibility_enabled and not (p.start_at <= now() and p.end_at > now()) and not qm.one_time_expired_override)
      )
  ) then raise exception using errcode = '22023', message = 'PREVIEW_MEMBER_NO_LONGER_ELIGIBLE'; end if;

  insert into public.matches (activity_id, court_id, court_name_snapshot, status, assignment_source, source_preview_id)
  values (target_activity_id, target_court_id, court_name_value, 'in_progress', 'preview_manual', target_queue_id)
  returning id into new_match_id;
  insert into public.match_players (match_id, activity_member_id, team, slot)
  select new_match_id, qm.activity_member_id, qm.team, qm.slot
  from public.preview_queue_members qm where qm.preview_queue_id = target_queue_id;
  update public.activity_members am set attendance_state = 'playing'
  where am.id in (select mp.activity_member_id from public.match_players mp where mp.match_id = new_match_id);
  delete from public.preview_queue_members qm where qm.preview_queue_id = target_queue_id;
  update public.courts set status = 'playing', active_match_id = new_match_id where id = target_court_id;
  return new_match_id;
end;
$$;

revoke all on function public.get_dispatch_state_v1(uuid) from public;
revoke all on function public.adjust_dispatch_resource_v1(uuid, text, text) from public;
revoke all on function public.assign_members_to_preview_v1(uuid, uuid, uuid[]) from public;
revoke all on function public.start_match_from_preview_v1(uuid, uuid, uuid) from public;
grant execute on function public.get_dispatch_state_v1(uuid) to authenticated;
grant execute on function public.adjust_dispatch_resource_v1(uuid, text, text) to authenticated;
grant execute on function public.assign_members_to_preview_v1(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.start_match_from_preview_v1(uuid, uuid, uuid) to authenticated;
