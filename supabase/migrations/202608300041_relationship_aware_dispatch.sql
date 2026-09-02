-- Make automatic selection and every four-player match honor relationship
-- priority. Team normalization is centralized in a trigger so manual preview,
-- direct manual and automatic paths behave the same way.

create or replace function public.select_auto_quartet_v4(target_activity_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  with cfg as (
    select a.auto_time_eligibility_enabled,coalesce(a.matching_settings->>'priority','balanced') priority,
      coalesce(a.matching_settings->>'levelMatch','balanced') level_match
    from public.activities a where a.id=target_activity_id
  ), stats as (
    select am.id,am.level,am.source_order,count(m.id) filter(where m.status='completed')::integer games_played,
      coalesce(max(m.ended_at) filter(where m.status='completed'),am.checked_in_at,am.created_at) last_available_at
    from public.activity_members am join public.plans p on p.id=am.plan_id cross join cfg
    left join public.match_players mp on mp.activity_member_id=am.id left join public.matches m on m.id=mp.match_id and m.activity_id=target_activity_id
    where am.activity_id=target_activity_id and am.registration_status='active' and am.checkin_status='checked_in' and am.attendance_state='idle'
      and not exists(select 1 from public.preview_queue_members q where q.activity_member_id=am.id)
      and (not cfg.auto_time_eligibility_enabled or (p.start_at<=now() and p.end_at>now())) group by am.id
  ), pool as (
    select s.*,row_number() over(order by case when cfg.priority='waiting' then extract(epoch from s.last_available_at) end,
      case when cfg.priority in('games','balanced') then s.games_played end,s.last_available_at,s.source_order,s.id) rank
    from stats s cross join cfg order by rank limit 16
  ), quartets as (
    select array[a.id,b.id,c.id,d.id] ids,(a.games_played+b.games_played+c.games_played+d.games_played) games_sum,
      (a.rank+b.rank+c.rank+d.rank) rank_sum,greatest(a.level,b.level,c.level,d.level)-least(a.level,b.level,c.level,d.level) level_spread
    from pool a join pool b on a.id<b.id join pool c on b.id<c.id join pool d on c.id<d.id
    where not exists(select 1 from public.member_relationships r where r.activity_id=target_activity_id and r.relationship_type='avoid_same_match' and r.consumed_at is null
      and r.member_low_id=any(array[a.id,b.id,c.id,d.id]) and r.member_high_id=any(array[a.id,b.id,c.id,d.id]))
  ), scored as (
    select q.*,coalesce((select sum(case r.relationship_type when 'one_match_oppose' then 100000 when 'one_match_bind' then 10000 else 100 end)
      from public.member_relationships r where r.activity_id=target_activity_id and r.consumed_at is null and r.relationship_type in('one_match_oppose','one_match_bind','persistent_bind')
        and ((r.member_low_id=any(q.ids))<>(r.member_high_id=any(q.ids)))),0) relation_penalty
    from quartets q
  )
  select s.ids from scored s cross join cfg order by s.relation_penalty,
    case cfg.priority when 'waiting' then s.rank_sum*100+s.games_sum*10 when 'games' then s.games_sum*1000+s.rank_sum else s.games_sum*400+s.rank_sum*20 end
      +s.level_spread*s.level_spread*case cfg.level_match when 'loose' then 8 when 'strict' then 80 else 30 end,s.ids::text limit 1;
$$;

create or replace function public.assign_relationship_teams_v1(target_activity_id uuid,target_member_ids uuid[])
returns table(activity_member_id uuid,slot smallint,team char(1)) language sql stable security definer set search_path='' as $$
  with ids as (select array_agg(x order by x) a from unnest(target_member_ids) x), partitions as (
    select 1 p,array[a[1],a[2]] team_a,array[a[3],a[4]] team_b from ids union all
    select 2,array[a[1],a[3]],array[a[2],a[4]] from ids union all select 3,array[a[1],a[4]],array[a[2],a[3]] from ids
  ), scores as (
    select p.*,
      coalesce((select sum(case
        when r.relationship_type='one_match_oppose' and ((r.member_low_id=any(p.team_a) and r.member_high_id=any(p.team_a)) or (r.member_low_id=any(p.team_b) and r.member_high_id=any(p.team_b))) then 100000
        when r.relationship_type='one_match_bind' and ((r.member_low_id=any(p.team_a))<>(r.member_high_id=any(p.team_a))) then 10000
        when r.relationship_type='persistent_bind' and ((r.member_low_id=any(p.team_a))<>(r.member_high_id=any(p.team_a))) then 100
        else 0 end) from public.member_relationships r where r.activity_id=target_activity_id and r.consumed_at is null
          and r.member_low_id=any(target_member_ids) and r.member_high_id=any(target_member_ids)),0)
      +abs((select sum(am.level) from public.activity_members am where am.id=any(p.team_a))-(select sum(am.level) from public.activity_members am where am.id=any(p.team_b))) relation_score
    from partitions p
  ), chosen as (select * from scores order by relation_score,p limit 1), assigned as (
    select x id,xo::smallint slot,'A'::char(1) team from chosen c,unnest(c.team_a) with ordinality u(x,xo) union all
    select x,(xo+2)::smallint,'B'::char(1) from chosen c,unnest(c.team_b) with ordinality u(x,xo)
  ) select id,slot,team from assigned;
$$;

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
  update public.member_relationships r set consumed_at=now() where r.activity_id=match_row.activity_id and r.consumed_at is null
    and r.relationship_type in('one_match_bind','one_match_oppose') and r.member_low_id=any(ids) and r.member_high_id=any(ids)
    and ((r.relationship_type='one_match_bind' and exists(select 1 from public.match_players x join public.match_players y on y.match_id=x.match_id and y.team=x.team where x.match_id=new.match_id and x.activity_member_id=r.member_low_id and y.activity_member_id=r.member_high_id))
      or (r.relationship_type='one_match_oppose' and exists(select 1 from public.match_players x join public.match_players y on y.match_id=x.match_id and y.team<>x.team where x.match_id=new.match_id and x.activity_member_id=r.member_low_id and y.activity_member_id=r.member_high_id)));
  return new;
end; $$;

drop trigger if exists match_players_normalize_relationships on public.match_players;
create trigger match_players_normalize_relationships after insert on public.match_players for each row execute function public.normalize_match_relationships_v1();

create or replace function public.clear_cancelled_member_relationships_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.registration_status<>'cancelled' and new.registration_status='cancelled' then
    delete from public.member_relationships r where r.activity_id=new.activity_id and new.id in(r.member_low_id,r.member_high_id);
  end if;
  return new;
end; $$;

drop trigger if exists activity_members_clear_cancelled_relationships on public.activity_members;
create trigger activity_members_clear_cancelled_relationships after update of registration_status on public.activity_members
for each row execute function public.clear_cancelled_member_relationships_v1();

create or replace function public.fill_auto_previews_v1(target_activity_id uuid,target_force boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity_row public.activities%rowtype; queue_row record; candidate_ids uuid[]; filled_count integer:=0;
begin
  select a.* into activity_row from public.activities a join public.organization_memberships om on om.organization_id=a.organization_id
  where a.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if activity_row.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status<>'in_progress' or activity_row.assign_mode<>'system_assign' then raise exception using errcode='22023',message='SYSTEM_ASSIGN_NOT_AVAILABLE'; end if;
  if not target_force and not activity_row.auto_mode_enabled then return jsonb_build_object('filled_queues',0,'reason','AUTO_MODE_DISABLED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text,10));
  for queue_row in select q.id from public.preview_queues q where q.activity_id=target_activity_id and not q.manually_edited and not exists(select 1 from public.preview_queue_members qm where qm.preview_queue_id=q.id) order by q.sort_order loop
    candidate_ids:=public.select_auto_quartet_v4(target_activity_id); if cardinality(candidate_ids)<>4 then exit; end if;
    insert into public.preview_queue_members(preview_queue_id,activity_member_id,slot,team)
      select queue_row.id,a.activity_member_id,a.slot,a.team from public.assign_relationship_teams_v1(target_activity_id,candidate_ids) a;
    update public.preview_queues set source='system' where id=queue_row.id; filled_count:=filled_count+1;
  end loop;
  return jsonb_build_object('filled_queues',filled_count);
end; $$;

revoke all on function public.select_auto_quartet_v4(uuid) from public;
revoke all on function public.assign_relationship_teams_v1(uuid,uuid[]) from public;

create or replace function public.cancel_completed_match_v1(target_activity_id uuid,target_match_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare match_row public.matches%rowtype;
begin
  if not public.owns_activity(target_activity_id) then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text,41));
  select m.* into match_row from public.matches m where m.id=target_match_id and m.activity_id=target_activity_id and m.status='completed' for update;
  if match_row.id is null then raise exception using errcode='22023',message='COMPLETED_MATCH_NOT_FOUND'; end if;
  update public.matches set status='cancelled',cancelled_at=now(),cancellation_reason='團主取消已完成對戰紀錄' where id=target_match_id;
end; $$;

revoke all on function public.cancel_completed_match_v1(uuid,uuid) from public;
grant execute on function public.cancel_completed_match_v1(uuid,uuid) to authenticated;
