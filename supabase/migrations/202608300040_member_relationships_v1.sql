-- Complete first-release member relationships. Relationship writes are kept in
-- one RPC so conflict rules cannot be bypassed by another client.

create or replace function public.get_member_relationships_v1(target_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare member_row public.activity_members%rowtype;
begin
  select am.* into member_row from public.activity_members am
  join public.activities a on a.id=am.activity_id
  join public.organization_memberships om on om.organization_id=a.organization_id
  where am.id=target_member_id and om.user_id=auth.uid() and om.role='owner';
  if member_row.id is null then raise exception using errcode='42501',message='MEMBER_NOT_FOUND'; end if;
  return jsonb_build_object(
    'persistent_bind_member_id',(select case when r.member_low_id=target_member_id then r.member_high_id else r.member_low_id end from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type='persistent_bind' and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id) limit 1),
    'one_match_bind_member_id',(select case when r.member_low_id=target_member_id then r.member_high_id else r.member_low_id end from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type='one_match_bind' and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id) limit 1),
    'one_match_oppose_member_id',(select case when r.member_low_id=target_member_id then r.member_high_id else r.member_low_id end from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type='one_match_oppose' and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id) limit 1),
    'avoid_same_match_member_ids',coalesce((select jsonb_agg(case when r.member_low_id=target_member_id then r.member_high_id else r.member_low_id end order by r.created_at) from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type='avoid_same_match' and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id)),'[]'::jsonb)
  );
end; $$;

create or replace function public.set_member_relationships_v1(
  target_member_id uuid,
  target_persistent_bind_member_id uuid default null,
  target_one_match_bind_member_id uuid default null,
  target_one_match_oppose_member_id uuid default null,
  target_avoid_same_match_member_ids uuid[] default array[]::uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare member_row public.activity_members%rowtype; candidate_id uuid; relation_kind public.relationship_type;
  requested uuid[]; requested_distinct integer;
begin
  select am.* into member_row from public.activity_members am join public.activities a on a.id=am.activity_id
  join public.organization_memberships om on om.organization_id=a.organization_id
  where am.id=target_member_id and am.registration_status='active' and om.user_id=auth.uid() and om.role='owner';
  if member_row.id is null then raise exception using errcode='42501',message='MEMBER_NOT_FOUND'; end if;
  target_avoid_same_match_member_ids:=coalesce(target_avoid_same_match_member_ids,array[]::uuid[]);
  requested:=array_remove(array[target_persistent_bind_member_id,target_one_match_bind_member_id,target_one_match_oppose_member_id],null)||target_avoid_same_match_member_ids;
  if target_member_id=any(requested) then raise exception using errcode='22023',message='RELATIONSHIP_SELF_REFERENCE'; end if;
  select count(distinct x) into requested_distinct from unnest(requested) x;
  if requested_distinct<>cardinality(requested) then raise exception using errcode='22023',message='RELATIONSHIP_TYPES_CONFLICT'; end if;
  if exists(select 1 from unnest(requested) x left join public.activity_members am on am.id=x and am.activity_id=member_row.activity_id and am.registration_status='active' where am.id is null)
    then raise exception using errcode='22023',message='RELATIONSHIP_MEMBER_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(member_row.activity_id::text,40));
  -- A member can have one active counterpart for each directed product rule.
  for candidate_id,relation_kind in select * from (values
    (target_persistent_bind_member_id,'persistent_bind'::public.relationship_type),
    (target_one_match_bind_member_id,'one_match_bind'::public.relationship_type),
    (target_one_match_oppose_member_id,'one_match_oppose'::public.relationship_type)) v(member_id,kind)
  loop
    if candidate_id is not null and exists(select 1 from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type=relation_kind and r.consumed_at is null and candidate_id in(r.member_low_id,r.member_high_id) and target_member_id not in(r.member_low_id,r.member_high_id))
      then raise exception using errcode='22023',message='RELATIONSHIP_MEMBER_ALREADY_ASSIGNED'; end if;
  end loop;
  delete from public.member_relationships r where r.activity_id=member_row.activity_id and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id);
  insert into public.member_relationships(activity_id,member_low_id,member_high_id,relationship_type,created_by)
  select member_row.activity_id,least(target_member_id,v.member_id),greatest(target_member_id,v.member_id),v.kind,auth.uid()
  from (values
    (target_persistent_bind_member_id,'persistent_bind'::public.relationship_type),
    (target_one_match_bind_member_id,'one_match_bind'::public.relationship_type),
    (target_one_match_oppose_member_id,'one_match_oppose'::public.relationship_type)) v(member_id,kind) where v.member_id is not null
  on conflict(activity_id,member_low_id,member_high_id,relationship_type) do update set consumed_at=null,created_by=excluded.created_by,created_at=now();
  insert into public.member_relationships(activity_id,member_low_id,member_high_id,relationship_type,created_by)
  select member_row.activity_id,least(target_member_id,x),greatest(target_member_id,x),'avoid_same_match',auth.uid() from unnest(target_avoid_same_match_member_ids) x
  on conflict(activity_id,member_low_id,member_high_id,relationship_type) do update set consumed_at=null,created_by=excluded.created_by,created_at=now();
  return public.get_member_relationships_v1(target_member_id);
end; $$;

revoke all on function public.get_member_relationships_v1(uuid) from public;
revoke all on function public.set_member_relationships_v1(uuid,uuid,uuid,uuid,uuid[]) from public;
grant execute on function public.get_member_relationships_v1(uuid) to authenticated;
grant execute on function public.set_member_relationships_v1(uuid,uuid,uuid,uuid,uuid[]) to authenticated;
