create or replace function public.get_activity_member_detail_v1(target_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare member_row public.activity_members%rowtype; avoid_ids jsonb;
begin
  select am.* into member_row from public.activity_members am
  join public.activities a on a.id = am.activity_id
  join public.organization_memberships om on om.organization_id = a.organization_id
  where am.id = target_member_id and om.user_id = auth.uid() and om.role = 'owner';
  if member_row.id is null then raise exception using errcode = '42501', message = 'MEMBER_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(case when mr.member_low_id = target_member_id then mr.member_high_id else mr.member_low_id end), '[]'::jsonb)
  into avoid_ids from public.member_relationships mr
  where mr.activity_id = member_row.activity_id and mr.relationship_type = 'avoid_same_match'
    and (mr.member_low_id = target_member_id or mr.member_high_id = target_member_id);
  return jsonb_build_object(
    'id', member_row.id, 'activity_id', member_row.activity_id, 'display_name', member_row.display_name,
    'gender', member_row.gender, 'level', member_row.level, 'plan_id', member_row.plan_id,
    'note', member_row.note, 'checkin_status', member_row.checkin_status,
    'payment_status', member_row.payment_status, 'payment_method', member_row.payment_method,
    'attendance_state', member_row.attendance_state, 'registration_status', member_row.registration_status,
    'avoid_member_ids', avoid_ids
  );
end;
$$;

create or replace function public.correct_member_checkin_payment_v1(
  target_member_id uuid,
  target_checkin_status public.checkin_status,
  target_payment_status public.payment_status,
  target_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.activity_members%rowtype;
  activity_row public.activities%rowtype;
  plan_amount integer;
begin
  select am.* into member_row
  from public.activity_members am
  join public.activities a on a.id = am.activity_id
  join public.organization_memberships om on om.organization_id = a.organization_id
  where am.id = target_member_id and om.user_id = auth.uid() and om.role = 'owner'
  for update of am;

  if member_row.id is null then raise exception using errcode = '42501', message = 'MEMBER_NOT_FOUND'; end if;
  if member_row.registration_status <> 'active' then raise exception using errcode = '22023', message = 'MEMBER_CANCELLED'; end if;
  if target_checkin_status = 'not_arrived' and (member_row.attendance_state <> 'idle' or exists(select 1 from public.preview_queue_members pqm where pqm.activity_member_id = member_row.id)) then
    raise exception using errcode = '22023', message = 'MEMBER_IN_DISPATCH';
  end if;

  select a.* into activity_row from public.activities a where a.id = member_row.activity_id;
  if target_payment_status = 'paid' then
    if not activity_row.finance_enabled then raise exception using errcode = '22023', message = 'FINANCE_DISABLED'; end if;
    if nullif(btrim(target_payment_method), '') is null or not (btrim(target_payment_method) = any(activity_row.enabled_payment_methods)) then
      raise exception using errcode = '22023', message = 'PAYMENT_METHOD_NOT_ENABLED';
    end if;
    select p.amount into plan_amount from public.plans p where p.id = member_row.plan_id;
    if plan_amount is null then raise exception using errcode = '22023', message = 'PLAN_AMOUNT_MISSING'; end if;
  end if;

  if member_row.payment_status = 'paid' and (target_payment_status = 'unpaid' or member_row.payment_method is distinct from btrim(target_payment_method)) then
    update public.payments set status = 'cancelled', updated_at = now()
    where activity_member_id = member_row.id and status = 'paid';
  end if;
  if target_payment_status = 'paid' and (member_row.payment_status = 'unpaid' or member_row.payment_method is distinct from btrim(target_payment_method)) then
    insert into public.payments(activity_id, activity_member_id, amount, method, status, paid_at)
    values(member_row.activity_id, member_row.id, plan_amount, btrim(target_payment_method), 'paid', now());
  end if;

  update public.activity_members set
    checkin_status = target_checkin_status,
    checked_in_at = case when target_checkin_status = 'checked_in' then coalesce(checked_in_at, now()) else null end,
    payment_status = target_payment_status,
    payment_method = case when target_payment_status = 'paid' then btrim(target_payment_method) else null end,
    paid_at = case when target_payment_status = 'paid' then coalesce(paid_at, now()) else null end
  where id = member_row.id;

  return jsonb_build_object('member_id', member_row.id, 'checkin_status', target_checkin_status, 'payment_status', target_payment_status);
end;
$$;

revoke all on function public.correct_member_checkin_payment_v1(uuid, public.checkin_status, public.payment_status, text) from public;
revoke all on function public.get_activity_member_detail_v1(uuid) from public;
grant execute on function public.correct_member_checkin_payment_v1(uuid, public.checkin_status, public.payment_status, text) to authenticated;
grant execute on function public.get_activity_member_detail_v1(uuid) to authenticated;
