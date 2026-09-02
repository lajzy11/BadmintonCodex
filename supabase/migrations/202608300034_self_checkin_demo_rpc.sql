create or replace function public.get_self_checkin_admin_v1(target_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.activities%rowtype; o public.organizations%rowtype; open_session boolean;
begin
  select a0.* into a from public.activities a0 join public.organization_memberships om on om.organization_id=a0.organization_id where a0.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if a.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  select * into o from public.organizations where id=a.organization_id;
  select exists(select 1 from public.self_checkin_sessions s where s.activity_id=a.id and s.closed_at is null) into open_session;
  return jsonb_build_object('is_open',open_session,'eligible',a.finance_enabled and 'line_pay'=any(a.enabled_payment_methods) and o.line_pay_demo_enabled and a.status in ('scheduled','in_progress') and exists(select 1 from public.activity_members m where m.activity_id=a.id and m.registration_status='active' and m.claim_status='unclaimed'),'activity_enabled',a.line_pay_self_checkin_enabled);
end; $$;

create or replace function public.open_self_checkin_v1(target_activity_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare a public.activities%rowtype; o public.organizations%rowtype; raw_token text;
begin
  select a0.* into a from public.activities a0 join public.organization_memberships om on om.organization_id=a0.organization_id where a0.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  select * into o from public.organizations where id=a.organization_id;
  if a.id is null or not a.finance_enabled or not ('line_pay'=any(a.enabled_payment_methods)) or not o.line_pay_demo_enabled or a.status not in ('scheduled','in_progress') or not exists(select 1 from public.activity_members m where m.activity_id=a.id and m.registration_status='active' and m.claim_status='unclaimed') then raise exception using errcode='22023',message='SELF_CHECKIN_NOT_ELIGIBLE'; end if;
  update public.self_checkin_sessions set closed_at=now() where activity_id=a.id and closed_at is null;
  raw_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.self_checkin_sessions(activity_id,token_hash,opened_by) values(a.id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid());
  update public.activities set line_pay_self_checkin_enabled=true where id=a.id;
  return raw_token;
end; $$;

create or replace function public.close_self_checkin_v1(target_activity_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_activity(target_activity_id) then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  update public.self_checkin_sessions set closed_at=now() where activity_id=target_activity_id and closed_at is null;
  update public.activities set line_pay_self_checkin_enabled=false where id=target_activity_id;
end; $$;

create or replace function public.get_public_self_checkin_v1(target_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.self_checkin_sessions%rowtype; a public.activities%rowtype; members jsonb;
begin
  select * into s from public.self_checkin_sessions where token_hash=encode(extensions.digest(target_token,'sha256'),'hex') and closed_at is null;
  if s.id is null then raise exception using errcode='22023',message='SELF_CHECKIN_LINK_INVALID'; end if;
  select * into a from public.activities where id=s.activity_id and line_pay_self_checkin_enabled and status in ('scheduled','in_progress');
  if a.id is null then raise exception using errcode='22023',message='SELF_CHECKIN_CLOSED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'display_name',m.display_name,'level',m.level,'plan_id',p.id,'plan_code',p.code,'start_at',p.start_at,'end_at',p.end_at,'amount',p.amount) order by m.display_name),'[]'::jsonb) into members from public.activity_members m join public.plans p on p.id=m.plan_id where m.activity_id=a.id and m.registration_status='active' and m.claim_status='unclaimed';
  return jsonb_build_object('activity',jsonb_build_object('title',coalesce(a.custom_title,a.venue_snapshot->>'name'),'activity_date',a.activity_date,'scheduled_start_at',a.scheduled_start_at,'scheduled_end_at',a.scheduled_end_at,'venue',a.venue_snapshot),'members',members);
end; $$;

create or replace function public.complete_public_self_checkin_v1(target_token text,target_member_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.self_checkin_sessions%rowtype; m public.activity_members%rowtype; amount_value integer; transaction_id text;
begin
  select * into s from public.self_checkin_sessions where token_hash=encode(extensions.digest(target_token,'sha256'),'hex') and closed_at is null for update;
  if s.id is null then raise exception using errcode='22023',message='SELF_CHECKIN_LINK_INVALID'; end if;
  select m0.* into m from public.activity_members m0 where m0.id=target_member_id and m0.activity_id=s.activity_id and m0.registration_status='active' for update;
  if m.id is null or m.claim_status<>'unclaimed' then raise exception using errcode='40001',message='MEMBER_ALREADY_CLAIMED'; end if;
  select coalesce(p.amount,0) into amount_value from public.plans p where p.id=m.plan_id;
  transaction_id := 'DEMO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  update public.activity_members set claim_status='claimed',claimed_at=now(),claimed_session_id=s.id,checkin_status='checked_in',checked_in_at=now(),payment_status='paid',payment_method='line_pay',paid_at=now() where id=m.id;
  insert into public.payments(activity_id,activity_member_id,amount,method,provider,environment,status,external_transaction_id,paid_at) values(s.activity_id,m.id,amount_value,'line_pay','line_pay','demo','paid',transaction_id,now());
  return jsonb_build_object('display_name',m.display_name,'transaction_id',transaction_id,'amount',amount_value);
end; $$;

revoke all on function public.get_self_checkin_admin_v1(uuid),public.open_self_checkin_v1(uuid),public.close_self_checkin_v1(uuid),public.get_public_self_checkin_v1(text),public.complete_public_self_checkin_v1(text,uuid) from public;
grant execute on function public.get_self_checkin_admin_v1(uuid),public.open_self_checkin_v1(uuid),public.close_self_checkin_v1(uuid) to authenticated;
grant execute on function public.get_public_self_checkin_v1(text),public.complete_public_self_checkin_v1(text,uuid) to anon,authenticated;
