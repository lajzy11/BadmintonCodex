-- Apply gender preferences to quartet selection/team assignment and let auto
-- mode advance one valid preview to the first idle court per cycle.

create or replace function public.select_auto_quartet_v3(target_activity_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  with activity_config as (
    select a.auto_time_eligibility_enabled,
      coalesce(a.matching_settings->>'priority', 'balanced') priority,
      coalesce(a.matching_settings->>'levelMatch', 'balanced') level_match,
      coalesce(a.matching_settings->>'repeatAvoidance', 'moderate') repeat_avoidance,
      coalesce(a.matching_settings->>'genderPreference', 'none') gender_preference
    from public.activities a where a.id = target_activity_id
  ), member_stats as (
    select am.id, am.level, am.gender, am.checked_in_at, am.source_order,
      count(m.id) filter (where m.status = 'completed')::integer games_played,
      coalesce(max(m.ended_at) filter (where m.status = 'completed'), am.checked_in_at, am.created_at) last_available_at
    from public.activity_members am join public.plans p on p.id = am.plan_id cross join activity_config cfg
    left join public.match_players mp on mp.activity_member_id = am.id
    left join public.matches m on m.id = mp.match_id and m.activity_id = target_activity_id
    where am.activity_id = target_activity_id and am.registration_status = 'active'
      and am.checkin_status = 'checked_in' and am.attendance_state = 'idle'
      and not exists (select 1 from public.preview_queue_members used where used.activity_member_id = am.id)
      and (not cfg.auto_time_eligibility_enabled or (p.start_at <= now() and p.end_at > now()))
    group by am.id
  ), candidate_pool as (
    select ms.*, row_number() over (order by
      case when cfg.priority = 'waiting' then extract(epoch from ms.last_available_at) end,
      case when cfg.priority in ('games','balanced') then ms.games_played end,
      ms.last_available_at, ms.source_order, ms.id) fairness_rank
    from member_stats ms cross join activity_config cfg order by fairness_rank limit 16
  ), quartets as (
    select array[a.id,b.id,c.id,d.id] ids,
      (a.games_played+b.games_played+c.games_played+d.games_played) games_sum,
      (a.fairness_rank+b.fairness_rank+c.fairness_rank+d.fairness_rank) rank_sum,
      (greatest(a.level,b.level,c.level,d.level)-least(a.level,b.level,c.level,d.level)) level_spread,
      ((case when a.gender = 'M' then 1 else 0 end)+(case when b.gender = 'M' then 1 else 0 end)+(case when c.gender = 'M' then 1 else 0 end)+(case when d.gender = 'M' then 1 else 0 end)) male_count,
      ((case when a.gender is null then 1 else 0 end)+(case when b.gender is null then 1 else 0 end)+(case when c.gender is null then 1 else 0 end)+(case when d.gender is null then 1 else 0 end)) unknown_gender_count
    from candidate_pool a join candidate_pool b on a.id < b.id join candidate_pool c on b.id < c.id join candidate_pool d on c.id < d.id
    where not exists (select 1 from public.member_relationships r where r.activity_id = target_activity_id and r.relationship_type = 'avoid_same_match'
      and r.member_low_id = any(array[a.id,b.id,c.id,d.id]) and r.member_high_id = any(array[a.id,b.id,c.id,d.id]))
  ), scored as (
    select q.*, coalesce((select sum(case when overlap_count = 4 then 12 else overlap_count*(overlap_count-1)/2 end)
      from (select count(*) overlap_count from public.matches hm join public.match_players hp on hp.match_id = hm.id
        where hm.activity_id = target_activity_id and hm.status = 'completed' and hp.activity_member_id = any(q.ids)
        group by hm.id having count(*) >= 2) overlap_rows),0) repeat_score
    from quartets q
  )
  select s.ids from scored s cross join activity_config cfg order by
    (case cfg.priority when 'waiting' then s.rank_sum*100+s.games_sum*10 when 'games' then s.games_sum*1000+s.rank_sum else s.games_sum*400+s.rank_sum*20 end)
    +(s.level_spread*s.level_spread*case cfg.level_match when 'loose' then 8 when 'strict' then 80 else 30 end)
    +(s.repeat_score*case cfg.repeat_avoidance when 'none' then 0 when 'strong' then 180 else 60 end)
    +(case when cfg.gender_preference = 'none' then 0 when s.unknown_gender_count > 0 then s.unknown_gender_count*20 else abs(s.male_count-2)*160 end),
    s.ids::text limit 1;
$$;

create or replace function public.assign_auto_teams_v2(target_activity_id uuid, target_member_ids uuid[])
returns table(activity_member_id uuid, slot smallint, team char(1)) language sql stable security definer set search_path = '' as $$
  with config as (select coalesce(matching_settings->>'genderPreference','none') preference from public.activities where id=target_activity_id),
  selected as (select am.id, am.level, am.gender,
    row_number() over (partition by am.gender order by am.level desc,am.id) gender_rank,
    row_number() over (order by am.level desc,am.id) level_rank from public.activity_members am where am.id=any(target_member_ids)),
  meta as (select count(*) filter(where gender='M') male_count,count(*) filter(where gender='F') female_count from selected)
  select s.id,
    (case when c.preference='mixed' and x.male_count=2 and x.female_count=2 then
      case when (s.gender='M' and s.gender_rank=1) then 1 when (s.gender='F' and s.gender_rank=2) then 2 when (s.gender='M' and s.gender_rank=2) then 3 else 4 end
    when c.preference='separate' and x.male_count=2 and x.female_count=2 then case when s.gender='M' then s.gender_rank else s.gender_rank+2 end
    else case s.level_rank when 1 then 1 when 4 then 2 when 2 then 3 else 4 end end)::smallint,
    (case when c.preference='mixed' and x.male_count=2 and x.female_count=2 then case when (s.gender='M' and s.gender_rank=1) or (s.gender='F' and s.gender_rank=2) then 'A' else 'B' end
      when c.preference='separate' and x.male_count=2 and x.female_count=2 then case when s.gender='M' then 'A' else 'B' end
      else case when s.level_rank in (1,4) then 'A' else 'B' end end)::char(1)
  from selected s cross join config c cross join meta x;
$$;

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
  for queue_row in select q.id from public.preview_queues q where q.activity_id=target_activity_id and not q.manually_edited
    and not exists(select 1 from public.preview_queue_members qm where qm.preview_queue_id=q.id) order by q.sort_order loop
    candidate_ids:=public.select_auto_quartet_v3(target_activity_id); if cardinality(candidate_ids)<>4 then exit; end if;
    insert into public.preview_queue_members(preview_queue_id,activity_member_id,slot,team)
      select queue_row.id,a.activity_member_id,a.slot,a.team from public.assign_auto_teams_v2(target_activity_id,candidate_ids) a;
    update public.preview_queues set source='system' where id=queue_row.id; filled_count:=filled_count+1;
  end loop;
  return jsonb_build_object('filled_queues',filled_count);
end;
$$;

create or replace function public.run_auto_dispatch_cycle_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity_row public.activities%rowtype; target_queue_id uuid; target_court_id uuid; new_match_id uuid; fill_result jsonb;
begin
  select a.* into activity_row from public.activities a join public.organization_memberships om on om.organization_id=a.organization_id
  where a.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if activity_row.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status<>'in_progress' or activity_row.assign_mode<>'system_assign' or not activity_row.auto_mode_enabled then return jsonb_build_object('started',false,'reason','AUTO_MODE_DISABLED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text,11));
  fill_result:=public.fill_auto_previews_v1(target_activity_id,false);
  select c.id into target_court_id from public.courts c where c.activity_id=target_activity_id and c.is_active and c.status='idle' and c.active_match_id is null order by c.sort_order limit 1;
  select q.id into target_queue_id from public.preview_queues q where q.activity_id=target_activity_id
    and (select count(*) from public.preview_queue_members qm where qm.preview_queue_id=q.id)=4
    and not exists(select 1 from public.preview_queue_members qm join public.activity_members am on am.id=qm.activity_member_id join public.plans p on p.id=am.plan_id
      where qm.preview_queue_id=q.id and (am.registration_status<>'active' or am.checkin_status<>'checked_in' or am.attendance_state<>'idle'
        or (activity_row.auto_time_eligibility_enabled and not(p.start_at<=now() and p.end_at>now()))))
    order by q.sort_order limit 1;
  if target_court_id is null or target_queue_id is null then return jsonb_build_object('started',false,'filled_queues',coalesce((fill_result->>'filled_queues')::integer,0)); end if;
  new_match_id:=public.start_match_from_preview_v1(target_activity_id,target_queue_id,target_court_id);
  update public.matches set assignment_source='auto_mode' where id=new_match_id;
  return jsonb_build_object('started',true,'match_id',new_match_id,'filled_queues',coalesce((fill_result->>'filled_queues')::integer,0));
end;
$$;

revoke all on function public.select_auto_quartet_v3(uuid) from public;
revoke all on function public.assign_auto_teams_v2(uuid,uuid[]) from public;
revoke all on function public.run_auto_dispatch_cycle_v1(uuid) from public;
grant execute on function public.run_auto_dispatch_cycle_v1(uuid) to authenticated;
