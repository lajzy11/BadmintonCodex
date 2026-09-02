-- Track which match consumed a one-match relationship so cancelling that
-- match can restore the organizer's intent without reviving unrelated rules.

alter table public.member_relationships
  add column consumed_match_id uuid references public.matches(id) on delete set null;

create index member_relationships_consumed_match_idx
  on public.member_relationships(consumed_match_id) where consumed_match_id is not null;

create or replace function public.normalize_match_relationships_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare match_row public.matches%rowtype; ids uuid[];
begin
  select m.* into match_row from public.matches m where m.id=new.match_id;
  select array_agg(mp.activity_member_id) into ids from public.match_players mp where mp.match_id=new.match_id;
  if cardinality(ids)<>4 then return new; end if;
  if exists(select 1 from public.member_relationships r where r.activity_id=match_row.activity_id and r.relationship_type='avoid_same_match' and r.consumed_at is null
    and r.member_low_id=any(ids) and r.member_high_id=any(ids)) then raise exception using errcode='22023',message='RELATIONSHIP_AVOID_SAME_MATCH'; end if;
  update public.match_players mp set team=a.team,slot=a.slot from public.assign_relationship_teams_v1(match_row.activity_id,ids) a
  where mp.match_id=new.match_id and mp.activity_member_id=a.activity_member_id;
  update public.member_relationships r set consumed_at=now(),consumed_match_id=new.match_id where r.activity_id=match_row.activity_id and r.consumed_at is null
    and r.relationship_type in('one_match_bind','one_match_oppose') and r.member_low_id=any(ids) and r.member_high_id=any(ids)
    and ((r.relationship_type='one_match_bind' and exists(select 1 from public.match_players x join public.match_players y on y.match_id=x.match_id and y.team=x.team where x.match_id=new.match_id and x.activity_member_id=r.member_low_id and y.activity_member_id=r.member_high_id))
      or (r.relationship_type='one_match_oppose' and exists(select 1 from public.match_players x join public.match_players y on y.match_id=x.match_id and y.team<>x.team where x.match_id=new.match_id and x.activity_member_id=r.member_low_id and y.activity_member_id=r.member_high_id)));
  return new;
end; $$;

create or replace function public.cancel_active_match_v1(target_activity_id uuid,target_match_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_court_id uuid;
begin
  if not public.owns_activity(target_activity_id) then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text,8));
  select m.court_id into target_court_id from public.matches m where m.id=target_match_id and m.activity_id=target_activity_id and m.status='in_progress' for update;
  if target_court_id is null then raise exception using errcode='22023',message='MATCH_NOT_IN_PROGRESS'; end if;
  update public.matches set status='cancelled',cancelled_at=now(),cancellation_reason='團主取消進行中對戰' where id=target_match_id;
  update public.member_relationships set consumed_at=null,consumed_match_id=null where consumed_match_id=target_match_id;
  update public.activity_members am set attendance_state='idle' where am.id in(select mp.activity_member_id from public.match_players mp where mp.match_id=target_match_id);
  update public.courts set status='idle',active_match_id=null where id=target_court_id and active_match_id=target_match_id;
end; $$;

create or replace function public.cancel_completed_match_v1(target_activity_id uuid,target_match_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare match_row public.matches%rowtype;
begin
  if not public.owns_activity(target_activity_id) then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text,41));
  select m.* into match_row from public.matches m where m.id=target_match_id and m.activity_id=target_activity_id and m.status='completed' for update;
  if match_row.id is null then raise exception using errcode='22023',message='COMPLETED_MATCH_NOT_FOUND'; end if;
  update public.matches set status='cancelled',cancelled_at=now(),cancellation_reason='團主取消已完成對戰紀錄' where id=target_match_id;
  update public.member_relationships set consumed_at=null,consumed_match_id=null where consumed_match_id=target_match_id;
end; $$;

create or replace function public.set_member_relationships_v1(
  target_member_id uuid,target_persistent_bind_member_id uuid default null,target_one_match_bind_member_id uuid default null,
  target_one_match_oppose_member_id uuid default null,target_avoid_same_match_member_ids uuid[] default array[]::uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare member_row public.activity_members%rowtype; candidate_id uuid; relation_kind public.relationship_type; requested uuid[]; requested_distinct integer;
begin
  select am.* into member_row from public.activity_members am join public.activities a on a.id=am.activity_id join public.organization_memberships om on om.organization_id=a.organization_id
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
  for candidate_id,relation_kind in select * from(values(target_persistent_bind_member_id,'persistent_bind'::public.relationship_type),(target_one_match_bind_member_id,'one_match_bind'::public.relationship_type),(target_one_match_oppose_member_id,'one_match_oppose'::public.relationship_type))v(member_id,kind) loop
    if candidate_id is not null and exists(select 1 from public.member_relationships r where r.activity_id=member_row.activity_id and r.relationship_type=relation_kind and r.consumed_at is null and candidate_id in(r.member_low_id,r.member_high_id) and target_member_id not in(r.member_low_id,r.member_high_id))
      then raise exception using errcode='22023',message='RELATIONSHIP_MEMBER_ALREADY_ASSIGNED'; end if;
  end loop;
  delete from public.member_relationships r where r.activity_id=member_row.activity_id and r.consumed_at is null and target_member_id in(r.member_low_id,r.member_high_id);
  insert into public.member_relationships(activity_id,member_low_id,member_high_id,relationship_type,created_by)
  select member_row.activity_id,least(target_member_id,v.member_id),greatest(target_member_id,v.member_id),v.kind,auth.uid() from(values(target_persistent_bind_member_id,'persistent_bind'::public.relationship_type),(target_one_match_bind_member_id,'one_match_bind'::public.relationship_type),(target_one_match_oppose_member_id,'one_match_oppose'::public.relationship_type))v(member_id,kind) where v.member_id is not null
  on conflict(activity_id,member_low_id,member_high_id,relationship_type) do update set consumed_at=null,consumed_match_id=null,created_by=excluded.created_by,created_at=now();
  insert into public.member_relationships(activity_id,member_low_id,member_high_id,relationship_type,created_by)
  select member_row.activity_id,least(target_member_id,x),greatest(target_member_id,x),'avoid_same_match',auth.uid() from unnest(target_avoid_same_match_member_ids)x
  on conflict(activity_id,member_low_id,member_high_id,relationship_type) do update set consumed_at=null,consumed_match_id=null,created_by=excluded.created_by,created_at=now();
  return public.get_member_relationships_v1(target_member_id);
end; $$;
