-- Start a manual match directly from four eligible members without a preview.

create or replace function public.start_direct_manual_match_v1(
  target_activity_id uuid,
  target_court_id uuid,
  target_member_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  activity_row public.activities%rowtype;
  court_name_value text;
  new_match_id uuid;
  valid_count integer;
begin
  if cardinality(target_member_ids) <> 4
    or (select count(distinct selected.member_id) from unnest(target_member_ids) selected(member_id)) <> 4 then
    raise exception using errcode = '22023', message = 'DIRECT_MATCH_REQUIRES_FOUR_MEMBERS';
  end if;

  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status <> 'in_progress' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_IN_PROGRESS'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 26));
  select c.name into court_name_value from public.courts c
  where c.id = target_court_id and c.activity_id = target_activity_id and c.is_active and c.status = 'idle' and c.active_match_id is null
  for update;
  if court_name_value is null then raise exception using errcode = '22023', message = 'COURT_NOT_AVAILABLE'; end if;

  select count(*) into valid_count from public.activity_members am
  join public.plans p on p.id = am.plan_id
  where am.activity_id = target_activity_id and am.id = any(target_member_ids)
    and am.registration_status = 'active' and am.checkin_status = 'checked_in' and am.attendance_state = 'idle'
    and not exists (select 1 from public.preview_queue_members pqm where pqm.activity_member_id = am.id)
    and (not activity_row.auto_time_eligibility_enabled or (p.start_at <= now() and p.end_at > now()));
  if valid_count <> 4 then raise exception using errcode = '22023', message = 'DIRECT_MATCH_MEMBER_NOT_ELIGIBLE'; end if;

  insert into public.matches(activity_id, court_id, court_name_snapshot, status, assignment_source)
  values(target_activity_id, target_court_id, court_name_value, 'in_progress', 'direct_manual') returning id into new_match_id;
  insert into public.match_players(match_id, activity_member_id, team, slot)
  select new_match_id, selected.member_id,
    case when selected.ordinality <= 2 then 'A' else 'B' end,
    selected.ordinality::smallint
  from unnest(target_member_ids) with ordinality selected(member_id, ordinality);
  update public.activity_members set attendance_state = 'playing' where id = any(target_member_ids);
  update public.courts set status = 'playing', active_match_id = new_match_id where id = target_court_id;
  return new_match_id;
end;
$$;

revoke all on function public.start_direct_manual_match_v1(uuid, uuid, uuid[]) from public;
grant execute on function public.start_direct_manual_match_v1(uuid, uuid, uuid[]) to authenticated;
