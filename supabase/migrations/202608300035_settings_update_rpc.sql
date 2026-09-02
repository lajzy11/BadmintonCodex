create or replace function public.update_club_settings_v1(target_organization_id uuid,target_name text,target_default_contact_info text,target_default_shuttlecock text,target_description text,target_line_pay_demo_enabled boolean,target_line_pay_demo_merchant_name text,target_line_pay_demo_merchant_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_organization_owner(target_organization_id) then raise exception using errcode='42501',message='ORGANIZATION_NOT_FOUND'; end if;
  if nullif(btrim(target_name),'') is null then raise exception using errcode='22023',message='ORGANIZATION_NAME_REQUIRED'; end if;
  if target_line_pay_demo_enabled and (nullif(btrim(target_line_pay_demo_merchant_name),'') is null or nullif(btrim(target_line_pay_demo_merchant_id),'') is null) then raise exception using errcode='22023',message='LINE_PAY_DEMO_CONFIG_REQUIRED'; end if;
  update public.organizations set name=btrim(target_name),default_contact_info=nullif(btrim(target_default_contact_info),''),default_shuttlecock=nullif(btrim(target_default_shuttlecock),''),description=nullif(btrim(target_description),''),line_pay_demo_enabled=target_line_pay_demo_enabled,line_pay_demo_merchant_name=nullif(btrim(target_line_pay_demo_merchant_name),''),line_pay_demo_merchant_id=nullif(btrim(target_line_pay_demo_merchant_id),'') where id=target_organization_id;
end; $$;
create or replace function public.update_account_display_name_v1(target_display_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or nullif(btrim(target_display_name),'') is null then raise exception using errcode='22023',message='DISPLAY_NAME_REQUIRED'; end if;
  update public.profiles set display_name=btrim(target_display_name) where id=auth.uid();
  if not found then raise exception using errcode='42501',message='PROFILE_NOT_FOUND'; end if;
end; $$;
revoke all on function public.update_club_settings_v1(uuid,text,text,text,text,boolean,text,text),public.update_account_display_name_v1(text) from public;
grant execute on function public.update_club_settings_v1(uuid,text,text,text,text,boolean,text,text),public.update_account_display_name_v1(text) to authenticated;
