-- Runtime automatic-mode state and the first deterministic multi-preview filler.

alter table public.activities add column auto_mode_enabled boolean not null default false;

create or replace function public.get_auto_dispatch_status_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare activity_row public.activities%rowtype;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  return jsonb_build_object('auto_mode_enabled', activity_row.auto_mode_enabled, 'assign_mode', activity_row.assign_mode, 'matching_settings', activity_row.matching_settings);
end;
$$;

create or replace function public.set_auto_dispatch_mode_v1(target_activity_id uuid, target_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_value boolean;
begin
  update public.activities a set auto_mode_enabled = target_enabled
  where a.id = target_activity_id and a.status = 'in_progress' and a.assign_mode = 'system_assign'
    and exists (select 1 from public.organization_memberships om where om.organization_id = a.organization_id and om.user_id = auth.uid() and om.role = 'owner')
  returning auto_mode_enabled into updated_value;
  if updated_value is null then raise exception using errcode = '22023', message = 'AUTO_MODE_NOT_AVAILABLE'; end if;
  return updated_value;
end;
$$;

create or replace function public.fill_auto_previews_v1(target_activity_id uuid, target_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  activity_row public.activities%rowtype;
  queue_row record;
  candidate_ids uuid[];
  filled_count integer := 0;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status <> 'in_progress' or activity_row.assign_mode <> 'system_assign' then
    raise exception using errcode = '22023', message = 'SYSTEM_ASSIGN_NOT_AVAILABLE';
  end if;
  if not target_force and not activity_row.auto_mode_enabled then
    return jsonb_build_object('filled_queues', 0, 'reason', 'AUTO_MODE_DISABLED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 10));
  for queue_row in
    select q.id from public.preview_queues q
    where q.activity_id = target_activity_id
      and not q.manually_edited
      and not exists (select 1 from public.preview_queue_members qm where qm.preview_queue_id = q.id)
    order by q.sort_order
  loop
    select array_agg(candidate.id order by candidate.games_played, candidate.last_ended_at nulls first, candidate.checked_in_at, candidate.source_order)
    into candidate_ids
    from (
      select am.id, am.checked_in_at, am.source_order,
        count(m.id) filter (where m.status = 'completed') as games_played,
        max(m.ended_at) filter (where m.status = 'completed') as last_ended_at
      from public.activity_members am
      join public.plans p on p.id = am.plan_id
      left join public.match_players mp on mp.activity_member_id = am.id
      left join public.matches m on m.id = mp.match_id and m.activity_id = target_activity_id
      where am.activity_id = target_activity_id
        and am.registration_status = 'active' and am.checkin_status = 'checked_in' and am.attendance_state = 'idle'
        and not exists (select 1 from public.preview_queue_members used where used.activity_member_id = am.id)
        and (not activity_row.auto_time_eligibility_enabled or (p.start_at <= now() and p.end_at > now()))
      group by am.id
      order by games_played, last_ended_at nulls first, am.checked_in_at, am.source_order
      limit 4
    ) candidate;

    if cardinality(candidate_ids) = 4 then
      insert into public.preview_queue_members (preview_queue_id, activity_member_id, slot, team)
      select queue_row.id, ranked.id,
        case ranked.level_rank when 1 then 1 when 4 then 2 when 2 then 3 else 4 end,
        case when ranked.level_rank in (1, 4) then 'A' else 'B' end
      from (
        select am.id, row_number() over (order by am.level desc, am.id)::smallint as level_rank
        from public.activity_members am where am.id = any(candidate_ids)
      ) ranked;
      update public.preview_queues set source = 'system' where id = queue_row.id;
      filled_count := filled_count + 1;
    else
      exit;
    end if;
  end loop;
  return jsonb_build_object('filled_queues', filled_count);
end;
$$;

revoke all on function public.get_auto_dispatch_status_v1(uuid) from public;
revoke all on function public.set_auto_dispatch_mode_v1(uuid, boolean) from public;
revoke all on function public.fill_auto_previews_v1(uuid, boolean) from public;
grant execute on function public.get_auto_dispatch_status_v1(uuid) to authenticated;
grant execute on function public.set_auto_dispatch_mode_v1(uuid, boolean) to authenticated;
grant execute on function public.fill_auto_previews_v1(uuid, boolean) to authenticated;
