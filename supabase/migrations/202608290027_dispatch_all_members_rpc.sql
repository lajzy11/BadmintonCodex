-- Full dispatch member projection with a single explainable ineligibility reason.

create or replace function public.get_dispatch_members_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare activity_row public.activities%rowtype;
begin
  select a.* into activity_row from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND'; end if;

  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', listed.id, 'display_name', listed.display_name, 'level', listed.level, 'gender', listed.gender,
    'plan_code', listed.plan_code, 'plan_start_at', listed.plan_start_at, 'plan_end_at', listed.plan_end_at,
    'checked_in_at', listed.checked_in_at, 'eligibility_reason', listed.eligibility_reason
  ) order by (listed.eligibility_reason is null) desc, listed.checked_in_at nulls last, listed.source_order)
  from (
    select am.id, am.display_name, am.level, am.gender, p.code plan_code,
      p.start_at plan_start_at, p.end_at plan_end_at, am.checked_in_at, am.source_order,
      case
        when am.checkin_status = 'not_arrived' then 'not_arrived'
        when am.attendance_state = 'playing' then 'playing'
        when am.attendance_state = 'rest' then 'rest'
        when exists (select 1 from public.preview_queue_members pqm where pqm.activity_member_id = am.id) then 'queued'
        when activity_row.auto_time_eligibility_enabled and now() < p.start_at then 'not_started'
        when activity_row.auto_time_eligibility_enabled and now() >= p.end_at then 'expired'
        else null
      end eligibility_reason
    from public.activity_members am join public.plans p on p.id = am.plan_id
    where am.activity_id = target_activity_id and am.registration_status = 'active'
  ) listed), '[]'::jsonb);
end;
$$;

revoke all on function public.get_dispatch_members_v1(uuid) from public;
grant execute on function public.get_dispatch_members_v1(uuid) to authenticated;
