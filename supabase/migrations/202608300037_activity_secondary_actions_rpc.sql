create or replace function public.save_activity_as_template_v1(target_activity_id uuid,target_template_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.activities%rowtype; config jsonb; new_id uuid;
begin
  select a0.* into a from public.activities a0 join public.organization_memberships om on om.organization_id=a0.organization_id where a0.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if a.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if nullif(btrim(target_template_name),'') is null then raise exception using errcode='22023',message='TEMPLATE_NAME_REQUIRED'; end if;
  config:=public.get_activity_copy_source_v1(a.id)-'activity_date';
  insert into public.activity_templates(organization_id,name,config_snapshot) values(a.organization_id,btrim(target_template_name),config) returning id into new_id;
  return new_id;
end; $$;

create or replace function public.reopen_activity_v1(target_activity_id uuid)
returns public.activity_status language plpgsql security definer set search_path='' as $$
declare a public.activities%rowtype; next_status public.activity_status;
begin
  select a0.* into a from public.activities a0 join public.organization_memberships om on om.organization_id=a0.organization_id where a0.id=target_activity_id and om.user_id=auth.uid() and om.role='owner' for update;
  if a.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if a.status<>'ended' then raise exception using errcode='22023',message='ONLY_ENDED_ACTIVITY_CAN_REOPEN'; end if;
  next_status:=case when a.scheduled_start_at>now() then 'scheduled'::public.activity_status else 'in_progress'::public.activity_status end;
  update public.activities set status=next_status,ended_at=null where id=a.id;
  return next_status;
end; $$;
revoke all on function public.save_activity_as_template_v1(uuid,text),public.reopen_activity_v1(uuid) from public;
grant execute on function public.save_activity_as_template_v1(uuid,text),public.reopen_activity_v1(uuid) to authenticated;
