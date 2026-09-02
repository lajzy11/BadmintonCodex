-- Update template contents without replacing or dropping the existing
-- rename/copy/delete management function.
create or replace function public.update_activity_template_v1(target_template_id uuid, target_config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_config is null then
    raise exception using errcode = '22023', message = 'TEMPLATE_CONFIG_REQUIRED';
  end if;

  update public.activity_templates t
  set config_snapshot = target_config
  from public.organization_memberships om
  where t.id = target_template_id
    and om.organization_id = t.organization_id
    and om.user_id = auth.uid()
    and om.role = 'owner';

  if not found then
    raise exception using errcode = '42501', message = 'TEMPLATE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.update_activity_template_v1(uuid,jsonb) from public;
grant execute on function public.update_activity_template_v1(uuid,jsonb) to authenticated;
