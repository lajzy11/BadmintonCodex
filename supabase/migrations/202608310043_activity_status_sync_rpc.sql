-- Synchronize scheduled activities from every authenticated workspace entry,
-- rather than requiring the organizer to visit dispatch first.

create or replace function public.sync_activity_statuses_v1(target_activity_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare changed_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  update public.activities a set status='in_progress',updated_at=now()
  where a.status='scheduled' and (target_activity_id is null or a.id=target_activity_id)
    and exists(select 1 from public.organization_memberships om where om.organization_id=a.organization_id and om.user_id=auth.uid() and om.role='owner')
    and exists(select 1 from public.plans p where p.activity_id=a.id and p.start_at<=now());
  get diagnostics changed_count=row_count;
  return changed_count;
end; $$;

revoke all on function public.sync_activity_statuses_v1(uuid) from public;
grant execute on function public.sync_activity_statuses_v1(uuid) to authenticated;
