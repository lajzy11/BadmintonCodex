-- Complete the manual dispatch loop: finish/cancel matches, edit optional
-- results, and expose recent match history in the dispatch projection.

create or replace function public.finish_match_v1(target_activity_id uuid, target_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_court_id uuid;
  released_count integer;
begin
  if not public.owns_activity(target_activity_id) then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 7));
  select m.court_id into target_court_id
  from public.matches m
  where m.id = target_match_id and m.activity_id = target_activity_id and m.status = 'in_progress'
  for update;
  if target_court_id is null then
    raise exception using errcode = '22023', message = 'MATCH_NOT_IN_PROGRESS';
  end if;

  update public.matches set status = 'completed', ended_at = now() where id = target_match_id;
  update public.activity_members am set attendance_state = 'idle'
  where am.id in (select mp.activity_member_id from public.match_players mp where mp.match_id = target_match_id);
  get diagnostics released_count = row_count;
  update public.courts set status = 'idle', active_match_id = null
  where id = target_court_id and active_match_id = target_match_id;
  return jsonb_build_object('match_id', target_match_id, 'released_members', released_count);
end;
$$;

create or replace function public.cancel_active_match_v1(target_activity_id uuid, target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_court_id uuid;
begin
  if not public.owns_activity(target_activity_id) then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 8));
  select m.court_id into target_court_id from public.matches m
  where m.id = target_match_id and m.activity_id = target_activity_id and m.status = 'in_progress'
  for update;
  if target_court_id is null then raise exception using errcode = '22023', message = 'MATCH_NOT_IN_PROGRESS'; end if;
  update public.matches set status = 'cancelled', cancelled_at = now(), cancellation_reason = '團主取消進行中對戰'
  where id = target_match_id;
  update public.activity_members am set attendance_state = 'idle'
  where am.id in (select mp.activity_member_id from public.match_players mp where mp.match_id = target_match_id);
  update public.courts set status = 'idle', active_match_id = null
  where id = target_court_id and active_match_id = target_match_id;
end;
$$;

create or replace function public.update_match_result_v1(
  target_activity_id uuid,
  target_match_id uuid,
  target_score_a smallint,
  target_score_b smallint,
  target_result public.match_result,
  target_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.owns_activity(target_activity_id) then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  if (target_score_a is null) <> (target_score_b is null) then
    raise exception using errcode = '22023', message = 'BOTH_SCORES_REQUIRED';
  end if;
  if target_score_a is not null and (target_score_a not between 0 and 99 or target_score_b not between 0 and 99) then
    raise exception using errcode = '22023', message = 'SCORE_OUT_OF_RANGE';
  end if;
  update public.matches
  set score_a = target_score_a,
      score_b = target_score_b,
      result = case when target_score_a is null then coalesce(target_result, 'unrecorded') else result end,
      note = nullif(btrim(target_note), '')
  where id = target_match_id and activity_id = target_activity_id and status = 'completed';
  if not found then raise exception using errcode = '22023', message = 'COMPLETED_MATCH_NOT_FOUND'; end if;
end;
$$;

create or replace function public.get_match_history_v1(target_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.owns_activity(target_activity_id) then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', m.id, 'court_name', m.court_name_snapshot, 'status', m.status,
    'started_at', m.started_at, 'ended_at', m.ended_at,
    'score_a', m.score_a, 'score_b', m.score_b, 'result', m.result, 'note', m.note,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'member_id', mp.activity_member_id, 'display_name', am.display_name,
      'team', mp.team, 'slot', mp.slot
    ) order by mp.slot) from public.match_players mp
      join public.activity_members am on am.id = mp.activity_member_id where mp.match_id = m.id), '[]'::jsonb)
  ) order by (m.status = 'cancelled'), m.started_at desc)
  from public.matches m where m.activity_id = target_activity_id and m.status <> 'in_progress'), '[]'::jsonb);
end;
$$;

revoke all on function public.finish_match_v1(uuid, uuid) from public;
revoke all on function public.cancel_active_match_v1(uuid, uuid) from public;
revoke all on function public.update_match_result_v1(uuid, uuid, smallint, smallint, public.match_result, text) from public;
revoke all on function public.get_match_history_v1(uuid) from public;
grant execute on function public.finish_match_v1(uuid, uuid) to authenticated;
grant execute on function public.cancel_active_match_v1(uuid, uuid) to authenticated;
grant execute on function public.update_match_result_v1(uuid, uuid, smallint, smallint, public.match_result, text) to authenticated;
grant execute on function public.get_match_history_v1(uuid) to authenticated;
