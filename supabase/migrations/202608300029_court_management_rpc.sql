-- Targeted court rename and empty-court removal.

create or replace function public.manage_court_v1(
  target_activity_id uuid,
  target_court_id uuid,
  target_action text,
  target_name text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare activity_status_value public.activity_status;
declare court_row public.courts%rowtype;
declare active_court_count integer;
declare normalized_name text;
begin
  select a.status into activity_status_value from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_status_value is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_status_value in ('ended', 'archived') then raise exception using errcode = '22023', message = 'ACTIVITY_ALREADY_ENDED'; end if;
  if target_action not in ('rename', 'delete') then raise exception using errcode = '22023', message = 'COURT_ACTION_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 29));
  select c.* into court_row from public.courts c
  where c.id = target_court_id and c.activity_id = target_activity_id and c.is_active for update;
  if court_row.id is null then raise exception using errcode = '22023', message = 'COURT_NOT_FOUND'; end if;

  if target_action = 'rename' then
    normalized_name := btrim(coalesce(target_name, ''));
    if length(normalized_name) < 1 or length(normalized_name) > 30 then raise exception using errcode = '22023', message = 'COURT_NAME_INVALID'; end if;
    if exists (select 1 from public.courts c where c.activity_id = target_activity_id and c.is_active and c.id <> target_court_id and lower(c.name) = lower(normalized_name)) then
      raise exception using errcode = '23505', message = 'COURT_NAME_DUPLICATED';
    end if;
    update public.courts set name = normalized_name where id = target_court_id;
    return jsonb_build_object('id', target_court_id, 'name', normalized_name, 'deleted', false);
  end if;

  if court_row.status <> 'idle' or court_row.active_match_id is not null then raise exception using errcode = '22023', message = 'COURT_IN_USE'; end if;
  select count(*) into active_court_count from public.courts c where c.activity_id = target_activity_id and c.is_active;
  if active_court_count <= 1 then raise exception using errcode = '22023', message = 'COURT_MINIMUM_REACHED'; end if;
  update public.courts set is_active = false where id = target_court_id;
  return jsonb_build_object('id', target_court_id, 'name', court_row.name, 'deleted', true);
end;
$$;

revoke all on function public.manage_court_v1(uuid, uuid, text, text) from public;
grant execute on function public.manage_court_v1(uuid, uuid, text, text) to authenticated;
