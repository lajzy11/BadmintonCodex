-- Activity payment settings and atomic batch check-in/collection.

create or replace function public.get_activity_payment_settings_v1(target_activity_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'finance_enabled', a.finance_enabled,
    'enabled_payment_methods', to_jsonb(a.enabled_payment_methods),
    'default_payment_method', a.default_payment_method
  )
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';
$$;

create or replace function public.batch_checkin_members_v1(
  target_activity_id uuid,
  target_member_ids uuid[],
  collect_payment boolean,
  target_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_row public.activities%rowtype;
  requested_count integer;
  valid_count integer;
  newly_checked_in integer;
  newly_paid integer := 0;
begin
  requested_count := cardinality(target_member_ids);
  if requested_count is null or requested_count < 1 or requested_count > 100 then
    raise exception using errcode = '22023', message = 'MEMBER_SELECTION_INVALID';
  end if;
  if (select count(distinct selected.member_id) from unnest(target_member_ids) as selected(member_id)) <> requested_count then
    raise exception using errcode = '22023', message = 'MEMBER_SELECTION_DUPLICATED';
  end if;

  select a.* into activity_row
  from public.activities a
  join public.organization_memberships om on om.organization_id = a.organization_id
  where a.id = target_activity_id and om.user_id = auth.uid() and om.role = 'owner';

  if activity_row.id is null then
    raise exception using errcode = '42501', message = 'ACTIVITY_NOT_FOUND';
  end if;
  if activity_row.status not in ('scheduled', 'in_progress') then
    raise exception using errcode = '22023', message = 'ACTIVITY_NOT_ACCEPTING_CHECKIN';
  end if;
  if collect_payment and not activity_row.finance_enabled then
    raise exception using errcode = '22023', message = 'FINANCE_DISABLED';
  end if;
  if collect_payment and (
    target_payment_method is null
    or not (target_payment_method = any(activity_row.enabled_payment_methods))
  ) then
    raise exception using errcode = '22023', message = 'PAYMENT_METHOD_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text, 2));
  select count(*) into valid_count
  from public.activity_members am
  where am.activity_id = target_activity_id
    and am.id = any(target_member_ids)
    and am.registration_status = 'active';
  if valid_count <> requested_count then
    raise exception using errcode = '22023', message = 'MEMBER_SELECTION_STALE';
  end if;

  select count(*) into newly_checked_in
  from public.activity_members am
  where am.activity_id = target_activity_id
    and am.id = any(target_member_ids)
    and am.checkin_status = 'not_arrived';

  update public.activity_members am
  set checkin_status = 'checked_in',
      checked_in_at = coalesce(am.checked_in_at, now())
  where am.activity_id = target_activity_id and am.id = any(target_member_ids);

  if collect_payment then
    if exists (
      select 1
      from public.activity_members am
      join public.plans p on p.id = am.plan_id
      where am.activity_id = target_activity_id
        and am.id = any(target_member_ids)
        and am.payment_status = 'unpaid'
        and p.amount is null
    ) then
      raise exception using errcode = '22023', message = 'PLAN_AMOUNT_MISSING';
    end if;

    insert into public.payments (
      activity_id, activity_member_id, amount, method, status, paid_at
    )
    select
      target_activity_id, am.id, p.amount, target_payment_method, 'paid', now()
    from public.activity_members am
    join public.plans p on p.id = am.plan_id
    where am.activity_id = target_activity_id
      and am.id = any(target_member_ids)
      and am.payment_status = 'unpaid';
    get diagnostics newly_paid = row_count;

    update public.activity_members am
    set payment_status = 'paid',
        payment_method = target_payment_method,
        paid_at = coalesce(am.paid_at, now())
    where am.activity_id = target_activity_id
      and am.id = any(target_member_ids)
      and am.payment_status = 'unpaid';
  end if;

  return jsonb_build_object(
    'selected', requested_count,
    'newly_checked_in', newly_checked_in,
    'newly_paid', newly_paid
  );
end;
$$;

revoke all on function public.get_activity_payment_settings_v1(uuid) from public;
revoke all on function public.batch_checkin_members_v1(uuid, uuid[], boolean, text) from public;
grant execute on function public.get_activity_payment_settings_v1(uuid) to authenticated;
grant execute on function public.batch_checkin_members_v1(uuid, uuid[], boolean, text) to authenticated;
