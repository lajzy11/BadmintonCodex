-- Read settings through narrowly scoped projections so the client never needs
-- to discover memberships or depend on table-level RLS for page bootstrap.
create or replace function public.get_account_settings_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select p.* into profile_row from public.profiles p where p.id = auth.uid();
  if profile_row.id is null then
    raise exception using errcode = '42501', message = 'PROFILE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'username_normalized', profile_row.username_normalized,
    'display_name', profile_row.display_name
  );
end;
$$;

create or replace function public.get_club_settings_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization_row public.organizations%rowtype;
  venue_count integer;
  template_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select o.* into organization_row
  from public.organization_memberships om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid() and om.role = 'owner'
  limit 1;

  if organization_row.id is null then
    raise exception using errcode = '42501', message = 'OWNER_ORGANIZATION_NOT_FOUND';
  end if;

  select count(*) into venue_count from public.organizer_venues v where v.organization_id = organization_row.id;
  select count(*) into template_count from public.activity_templates t where t.organization_id = organization_row.id;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization_row.id,
      'name', organization_row.name,
      'default_contact_info', organization_row.default_contact_info,
      'default_shuttlecock', organization_row.default_shuttlecock,
      'description', organization_row.description,
      'line_pay_demo_enabled', organization_row.line_pay_demo_enabled,
      'line_pay_demo_merchant_name', organization_row.line_pay_demo_merchant_name,
      'line_pay_demo_merchant_id', organization_row.line_pay_demo_merchant_id
    ),
    'counts', jsonb_build_object('venues', venue_count, 'templates', template_count)
  );
end;
$$;

revoke all on function public.get_account_settings_v1() from public;
revoke all on function public.get_club_settings_v1() from public;
grant execute on function public.get_account_settings_v1() to authenticated;
grant execute on function public.get_club_settings_v1() to authenticated;
