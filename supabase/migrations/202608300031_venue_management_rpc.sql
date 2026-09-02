-- Complete "My venues" read and owner-only CRUD projections.
create or replace function public.get_organizer_venues_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'name', v.name, 'region', v.region, 'district', v.district,
    'address', v.address, 'floor_type', v.floor_type, 'note', v.note,
    'last_used_at', v.last_used_at, 'use_count', v.use_count, 'updated_at', v.updated_at
  ) order by v.last_used_at desc nulls last, v.updated_at desc), '[]'::jsonb)
  from public.organizer_venues v
  join public.organization_memberships om on om.organization_id = v.organization_id
  where om.user_id = auth.uid() and om.role = 'owner';
$$;

create or replace function public.save_organizer_venue_v1(
  target_venue_id uuid, target_name text, target_region text, target_district text,
  target_address text, target_floor_type text, target_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare owner_organization_id uuid; saved_id uuid;
begin
  select om.organization_id into owner_organization_id from public.organization_memberships om
  where om.user_id = auth.uid() and om.role = 'owner' limit 1;
  if owner_organization_id is null then raise exception using errcode = '42501', message = 'OWNER_ORGANIZATION_NOT_FOUND'; end if;
  if nullif(btrim(target_name), '') is null or nullif(btrim(target_region), '') is null or nullif(btrim(target_district), '') is null then
    raise exception using errcode = '22023', message = 'VENUE_REQUIRED_FIELDS_MISSING';
  end if;

  if target_venue_id is null then
    insert into public.organizer_venues (organization_id, name, region, district, address, floor_type, note)
    values (owner_organization_id, btrim(target_name), btrim(target_region), btrim(target_district), nullif(btrim(target_address), ''), nullif(btrim(target_floor_type), ''), nullif(btrim(target_note), ''))
    returning id into saved_id;
  else
    update public.organizer_venues set name=btrim(target_name), region=btrim(target_region), district=btrim(target_district), address=nullif(btrim(target_address), ''), floor_type=nullif(btrim(target_floor_type), ''), note=nullif(btrim(target_note), '')
    where id=target_venue_id and organization_id=owner_organization_id returning id into saved_id;
    if saved_id is null then raise exception using errcode = '42501', message = 'VENUE_NOT_FOUND'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.delete_organizer_venue_v1(target_venue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.organizer_venues v using public.organization_memberships om
  where v.id=target_venue_id and om.organization_id=v.organization_id and om.user_id=auth.uid() and om.role='owner';
  if not found then raise exception using errcode = '42501', message = 'VENUE_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.get_organizer_venues_v1() from public;
revoke all on function public.save_organizer_venue_v1(uuid,text,text,text,text,text,text) from public;
revoke all on function public.delete_organizer_venue_v1(uuid) from public;
grant execute on function public.get_organizer_venues_v1() to authenticated;
grant execute on function public.save_organizer_venue_v1(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.delete_organizer_venue_v1(uuid) to authenticated;
