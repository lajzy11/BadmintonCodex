create or replace function public.get_activity_member_detail_v1(target_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare member_row public.activity_members%rowtype; avoid_ids jsonb;
begin
  select am.* into member_row from public.activity_members am
  join public.activities a on a.id=am.activity_id
  join public.organization_memberships om on om.organization_id=a.organization_id
  where am.id=target_member_id and om.user_id=auth.uid() and om.role='owner';
  if member_row.id is null then raise exception using errcode='42501',message='MEMBER_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(case when mr.member_low_id=target_member_id then mr.member_high_id else mr.member_low_id end),'[]'::jsonb)
  into avoid_ids from public.member_relationships mr where mr.activity_id=member_row.activity_id
    and mr.relationship_type='avoid_same_match' and (mr.member_low_id=target_member_id or mr.member_high_id=target_member_id);
  return jsonb_build_object('id',member_row.id,'activity_id',member_row.activity_id,'display_name',member_row.display_name,
    'gender',member_row.gender,'level',member_row.level,'plan_id',member_row.plan_id,'note',member_row.note,
    'checkin_status',member_row.checkin_status,'payment_status',member_row.payment_status,'payment_method',member_row.payment_method,
    'no_show_status',member_row.no_show_status,'attendance_state',member_row.attendance_state,
    'registration_status',member_row.registration_status,'avoid_member_ids',avoid_ids);
end; $$;

create or replace function public.set_member_payment_waiver_v1(target_member_id uuid,target_waived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member_row public.activity_members%rowtype;
begin
  select am.* into member_row from public.activity_members am join public.activities a on a.id=am.activity_id
  join public.organization_memberships om on om.organization_id=a.organization_id
  where am.id=target_member_id and om.user_id=auth.uid() and om.role='owner' for update of am;
  if member_row.id is null then raise exception using errcode='42501',message='MEMBER_NOT_FOUND'; end if;
  if member_row.registration_status<>'active' then raise exception using errcode='22023',message='MEMBER_CANCELLED'; end if;
  if target_waived and member_row.payment_status='paid' then raise exception using errcode='22023',message='PAID_MEMBER_CANNOT_WAIVE'; end if;
  update public.activity_members set no_show_status=case when target_waived then 'waived'::public.no_show_status else null end where id=member_row.id;
  return jsonb_build_object('member_id',member_row.id,'waived',target_waived);
end; $$;

create or replace function public.get_activity_waived_member_ids_v1(target_activity_id uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(am.id),array[]::uuid[]) from public.activity_members am
  join public.activities a on a.id=am.activity_id
  join public.organization_memberships om on om.organization_id=a.organization_id
  where am.activity_id=target_activity_id and om.user_id=auth.uid() and om.role='owner' and am.no_show_status='waived';
$$;

revoke all on function public.get_activity_member_detail_v1(uuid),public.set_member_payment_waiver_v1(uuid,boolean),public.get_activity_waived_member_ids_v1(uuid) from public;
grant execute on function public.get_activity_member_detail_v1(uuid),public.set_member_payment_waiver_v1(uuid,boolean),public.get_activity_waived_member_ids_v1(uuid) to authenticated;
