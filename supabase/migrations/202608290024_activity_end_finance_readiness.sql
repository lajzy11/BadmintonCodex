-- Do not surface payment warnings when accounting is disabled for the activity.

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
    'unpaid_members', case when activity_row.finance_enabled then
      (select count(*) from public.activity_members am where am.activity_id = target_activity_id and am.registration_status = 'active' and am.payment_status = 'unpaid')
      else 0 end,
    'not_arrived_members', (select count(*) from public.activity_members am where am.activity_id = target_activity_id and am.registration_status = 'active' and am.checkin_status = 'not_arrived')
  );
end;
$$;
