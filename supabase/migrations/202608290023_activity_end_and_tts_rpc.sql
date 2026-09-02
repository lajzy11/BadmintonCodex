-- Manual activity closeout readiness and browser TTS settings projection.

create or replace function public.get_auto_dispatch_status_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare activity_row public.activities%rowtype;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  return jsonb_build_object(
    'auto_mode_enabled', activity_row.auto_mode_enabled,
    'assign_mode', activity_row.assign_mode,
    'matching_settings', activity_row.matching_settings,
    'tts_settings', activity_row.tts_settings
  );
end;
$$;

create or replace function public.get_activity_end_readiness_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare activity_row public.activities%rowtype;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;

  return jsonb_build_object(
    'status', activity_row.status,
    'active_matches', (select count(*) from public.matches m where m.activity_id = target_activity_id and m.status = 'in_progress'),
    'queued_members', (select count(*) from public.preview_queue_members pqm join public.preview_queues pq on pq.id = pqm.preview_queue_id where pq.activity_id = target_activity_id),
    'unpaid_members', (select count(*) from public.activity_members am where am.activity_id = target_activity_id and am.registration_status = 'active' and am.payment_status = 'unpaid'),
    'not_arrived_members', (select count(*) from public.activity_members am where am.activity_id = target_activity_id and am.registration_status = 'active' and am.checkin_status = 'not_arrived')
  );
end;
$$;

create or replace function public.end_activity_v1(target_activity_id uuid, clear_previews boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  activity_row public.activities%rowtype;
  active_match_count integer;
  queued_member_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 0));

  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner'
  for update of a;
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status <> 'in_progress' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_IN_PROGRESS'; end if;

  select count(*) into active_match_count from public.matches m where m.activity_id = target_activity_id and m.status = 'in_progress';
  if active_match_count > 0 then raise exception using errcode = '22023', message = 'ACTIVE_MATCHES_REMAIN'; end if;

  select count(*) into queued_member_count
  from public.preview_queue_members pqm join public.preview_queues pq on pq.id = pqm.preview_queue_id
  where pq.activity_id = target_activity_id;
  if queued_member_count > 0 and not clear_previews then raise exception using errcode = '22023', message = 'PREVIEWS_REMAIN'; end if;

  if queued_member_count > 0 then
    delete from public.preview_queue_members pqm using public.preview_queues pq
    where pqm.preview_queue_id = pq.id and pq.activity_id = target_activity_id;
  end if;

  update public.activities set
    status = 'ended', ended_at = now(), auto_mode_enabled = false,
    line_pay_self_checkin_enabled = false, updated_at = now()
  where id = target_activity_id;

  return jsonb_build_object('ended', true, 'cleared_members', queued_member_count);
end;
$$;

revoke all on function public.get_activity_end_readiness_v1(uuid) from public;
revoke all on function public.end_activity_v1(uuid, boolean) from public;
grant execute on function public.get_activity_end_readiness_v1(uuid) to authenticated;
grant execute on function public.end_activity_v1(uuid, boolean) to authenticated;
