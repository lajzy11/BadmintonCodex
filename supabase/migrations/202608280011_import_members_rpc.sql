-- Atomically inserts a validated import batch. Parsing and row correction are
-- performed client-side; the database independently verifies every row.

create or replace function public.import_activity_members_v1(
  target_activity_id uuid,
  import_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
  import_count integer;
  next_source_order integer;
  active_member_count integer;
  inserted_ids jsonb;
  warning_items jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(import_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'IMPORT_ROWS_REQUIRED';
  end if;
  import_count := jsonb_array_length(import_rows);
  if import_count < 1 or import_count > 300 then
    raise exception using errcode = '22023', message = 'IMPORT_ROW_COUNT_INVALID';
  end if;

  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
  if activity_row.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  if activity_row.status not in ('scheduled', 'in_progress') then
    raise exception using errcode = '22023', message = 'ACTIVITY_NOT_ACCEPTING_MEMBERS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(import_rows) as row_data(
      display_name text, level integer, plan_id uuid, gender text, note text
    )
    where nullif(btrim(row_data.display_name), '') is null
      or row_data.level not between 1 and 18
      or (row_data.gender is not null and row_data.gender not in ('M', 'F'))
      or not exists (
        select 1 from public.plans p
        where p.id = row_data.plan_id and p.activity_id = target_activity_id
      )
  ) then
    raise exception using errcode = '22023', message = 'IMPORT_ROW_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 3));
  select count(*), coalesce(max(am.source_order), -1) + 1
  into active_member_count, next_source_order
  from public.activity_members am
  where am.activity_id = target_activity_id and am.registration_status = 'active';

  if activity_row.capacity_mode = 'limited'
    and active_member_count + import_count > activity_row.capacity_limit then
    warning_items := warning_items || '"CAPACITY_EXCEEDED"'::jsonb;
  end if;

  with parsed_rows as (
    select row_data.*, (row_number() over ())::integer - 1 as row_offset
    from jsonb_to_recordset(import_rows) as row_data(
      display_name text, level integer, plan_id uuid, gender text, note text
    )
  ), inserted as (
    insert into public.activity_members (
      activity_id, display_name, level, plan_id, gender, note, source, source_order
    )
    select
      target_activity_id,
      btrim(parsed_rows.display_name),
      parsed_rows.level,
      parsed_rows.plan_id,
      parsed_rows.gender::public.member_gender,
      nullif(btrim(parsed_rows.note), ''),
      'import',
      next_source_order + parsed_rows.row_offset
    from parsed_rows
    returning id
  )
  select jsonb_agg(id) into inserted_ids from inserted;

  return jsonb_build_object(
    'inserted_count', import_count,
    'member_ids', coalesce(inserted_ids, '[]'::jsonb),
    'warnings', warning_items
  );
end;
$$;

revoke all on function public.import_activity_members_v1(uuid, jsonb) from public;
grant execute on function public.import_activity_members_v1(uuid, jsonb) to authenticated;
