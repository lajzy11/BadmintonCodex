-- Manual controls for preview members whose plan time expires while queued.

create or replace function public.get_preview_issues_v1(target_activity_id uuid)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'queue_id', q.id,
      'member_id', qm.activity_member_id,
      'plan_end_at', p.end_at,
      'expired', a.auto_time_eligibility_enabled and not (p.start_at <= now() and p.end_at > now()),
      'one_time_expired_override', qm.one_time_expired_override
    ))
    from public.preview_queues q
    join public.preview_queue_members qm on qm.preview_queue_id = q.id
    join public.activity_members am on am.id = qm.activity_member_id
    join public.plans p on p.id = am.plan_id
    join public.activities a on a.id = q.activity_id
    where q.activity_id = target_activity_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.manage_preview_member_v1(
  target_activity_id uuid,
  target_queue_id uuid,
  target_member_id uuid,
  target_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot smallint;
  activity_status_value public.activity_status;
begin
  select a.status into activity_status_value
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_status_value is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;
  if activity_status_value <> 'in_progress' then raise exception using errcode = '22023', message = 'ACTIVITY_NOT_IN_PROGRESS'; end if;
  if target_action not in ('remove', 'allow_expired_once') then raise exception using errcode = '22023', message = 'PREVIEW_ACTION_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 9));
  select qm.slot into target_slot
  from public.preview_queue_members qm
  join public.preview_queues q on q.id = qm.preview_queue_id
  where q.activity_id = target_activity_id and q.id = target_queue_id and qm.activity_member_id = target_member_id
  for update of qm;
  if target_slot is null then raise exception using errcode = '22023', message = 'PREVIEW_MEMBER_NOT_FOUND'; end if;

  if target_action = 'allow_expired_once' then
    if not exists (
      select 1 from public.activity_members am
      join public.plans p on p.id = am.plan_id
      join public.activities a on a.id = am.activity_id
      where am.id = target_member_id and am.activity_id = target_activity_id
        and a.auto_time_eligibility_enabled and not (p.start_at <= now() and p.end_at > now())
    ) then raise exception using errcode = '22023', message = 'MEMBER_TIME_NOT_EXPIRED'; end if;
    update public.preview_queue_members
    set one_time_expired_override = true, override_granted_by = auth.uid(), override_granted_at = now()
    where preview_queue_id = target_queue_id and activity_member_id = target_member_id;
  else
    delete from public.preview_queue_members
    where preview_queue_id = target_queue_id and activity_member_id = target_member_id;
    with remaining as (
      delete from public.preview_queue_members
      where preview_queue_id = target_queue_id
      returning activity_member_id, slot, one_time_expired_override, override_granted_by, override_granted_at
    ), ordered as (
      select *, row_number() over (order by slot)::smallint as new_slot from remaining
    )
    insert into public.preview_queue_members (
      preview_queue_id, activity_member_id, slot, team,
      one_time_expired_override, override_granted_by, override_granted_at
    )
    select target_queue_id, activity_member_id, new_slot,
      case when new_slot <= 2 then 'A' else 'B' end,
      one_time_expired_override, override_granted_by, override_granted_at
    from ordered;
  end if;
  update public.preview_queues set manually_edited = true where id = target_queue_id;
end;
$$;

revoke all on function public.get_preview_issues_v1(uuid) from public;
revoke all on function public.manage_preview_member_v1(uuid, uuid, uuid, text) from public;
grant execute on function public.get_preview_issues_v1(uuid) to authenticated;
grant execute on function public.manage_preview_member_v1(uuid, uuid, uuid, text) to authenticated;
