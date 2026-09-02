-- Creates the profile and the V1 owner organization in one transaction after
-- the Edge Function has created the corresponding auth.users row.

create or replace function public.onboard_account(
  target_user_id uuid,
  target_username_normalized text,
  target_display_name text,
  target_organization_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception using errcode = '23503', message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.profiles (id, username_normalized, display_name)
  values (
    target_user_id,
    lower(btrim(target_username_normalized)),
    btrim(target_display_name)
  );

  insert into public.organizations (name)
  values (btrim(target_organization_name))
  returning id into new_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, target_user_id, 'owner');

  return new_organization_id;
end;
$$;

revoke all on function public.onboard_account(uuid, text, text, text) from public;
grant execute on function public.onboard_account(uuid, text, text, text) to service_role;
