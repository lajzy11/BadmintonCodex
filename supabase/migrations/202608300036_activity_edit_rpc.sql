create or replace function public.update_activity_v1(target_activity_id uuid, payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a public.activities%rowtype; plan_item jsonb; retained_codes text[]:=array[]::text[];
begin
  select a0.* into a from public.activities a0 join public.organization_memberships om on om.organization_id=a0.organization_id where a0.id=target_activity_id and om.user_id=auth.uid() and om.role='owner' for update;
  if a.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if a.status not in ('draft','scheduled') then raise exception using errcode='22023',message='ACTIVITY_EDIT_NOT_ALLOWED'; end if;
  if jsonb_array_length(payload->'plans')<1 or jsonb_array_length(payload->'plans')>5 then raise exception using errcode='22023',message='PLAN_COUNT_INVALID'; end if;
  update public.activities set activity_date=(payload->>'activity_date')::date,venue_snapshot=payload->'venue',initial_court_count=(payload->>'initial_court_count')::smallint,capacity_mode=(payload->>'capacity_mode')::public.capacity_mode,capacity_limit=(payload->>'capacity_limit')::smallint,skill_min=(payload->>'skill_min')::smallint,skill_max=(payload->>'skill_max')::smallint,assign_mode=(payload->>'assign_mode')::public.assign_mode,custom_title=nullif(btrim(payload->>'custom_title'),''),shuttlecock=nullif(btrim(payload->>'shuttlecock'),''),contact_info=nullif(btrim(payload->>'contact_info'),''),description=nullif(btrim(payload->>'description'),''),finance_enabled=(payload->>'finance_enabled')::boolean,enabled_payment_methods=coalesce(array(select jsonb_array_elements_text(payload->'enabled_payment_methods')),array[]::text[]),default_payment_method=nullif(payload->>'default_payment_method',''),auto_time_eligibility_enabled=(payload->>'auto_time_eligibility_enabled')::boolean,matching_settings=payload->'matching_settings',tts_settings=payload->'tts_settings' where id=a.id;
  for plan_item in select * from jsonb_array_elements(payload->'plans') loop
    retained_codes:=array_append(retained_codes,plan_item->>'code');
    insert into public.plans(activity_id,code,start_at,end_at,amount) values(a.id,(plan_item->>'code')::char(1),(plan_item->>'start_at')::timestamptz,(plan_item->>'end_at')::timestamptz,(plan_item->>'amount')::integer)
    on conflict(activity_id,code) do update set start_at=excluded.start_at,end_at=excluded.end_at,amount=excluded.amount;
  end loop;
  if exists(select 1 from public.plans p join public.activity_members m on m.plan_id=p.id where p.activity_id=a.id and not(p.code::text=any(retained_codes))) then raise exception using errcode='22023',message='PLAN_WITH_MEMBERS_CANNOT_BE_DELETED'; end if;
  delete from public.plans p where p.activity_id=a.id and not(p.code::text=any(retained_codes));
  select min(start_at),max(end_at) into a.scheduled_start_at,a.scheduled_end_at from public.plans where activity_id=a.id;
  update public.activities set scheduled_start_at=a.scheduled_start_at,scheduled_end_at=a.scheduled_end_at,status=case when a.status='draft' then 'draft'::public.activity_status when a.scheduled_start_at<=now() then 'in_progress'::public.activity_status else 'scheduled'::public.activity_status end where id=a.id;
end; $$;
revoke all on function public.update_activity_v1(uuid,jsonb) from public;
grant execute on function public.update_activity_v1(uuid,jsonb) to authenticated;
