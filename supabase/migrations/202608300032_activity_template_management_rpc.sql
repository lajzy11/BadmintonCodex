create or replace function public.get_activity_templates_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'config_snapshot',t.config_snapshot,'updated_at',t.updated_at) order by t.updated_at desc),'[]'::jsonb)
  from public.activity_templates t join public.organization_memberships om on om.organization_id=t.organization_id
  where om.user_id=auth.uid() and om.role='owner';
$$;

create or replace function public.manage_activity_template_v1(target_template_id uuid, target_action text, target_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare template_row public.activity_templates%rowtype; new_id uuid;
begin
  select t.* into template_row from public.activity_templates t join public.organization_memberships om on om.organization_id=t.organization_id
  where t.id=target_template_id and om.user_id=auth.uid() and om.role='owner';
  if template_row.id is null then raise exception using errcode='42501', message='TEMPLATE_NOT_FOUND'; end if;
  if target_action='rename' then
    if nullif(btrim(target_name),'') is null then raise exception using errcode='22023', message='TEMPLATE_NAME_REQUIRED'; end if;
    update public.activity_templates set name=btrim(target_name) where id=template_row.id; return template_row.id;
  elsif target_action='copy' then
    insert into public.activity_templates(organization_id,name,config_snapshot) values(template_row.organization_id, left(template_row.name || ' 副本',50), template_row.config_snapshot) returning id into new_id; return new_id;
  elsif target_action='delete' then
    delete from public.activity_templates where id=template_row.id; return template_row.id;
  else raise exception using errcode='22023', message='TEMPLATE_ACTION_INVALID'; end if;
end;
$$;

revoke all on function public.get_activity_templates_v1() from public;
revoke all on function public.manage_activity_template_v1(uuid,text,text) from public;
grant execute on function public.get_activity_templates_v1() to authenticated;
grant execute on function public.manage_activity_template_v1(uuid,text,text) to authenticated;
