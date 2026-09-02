-- Replace only expired preview positions while preserving the other members.
-- If no valid replacement exists the queue remains blocked for organizer action.

create or replace function public.select_auto_replacement_v1(
  target_activity_id uuid, target_queue_id uuid, expired_member_id uuid
)
returns uuid language sql stable security definer set search_path='' as $$
  with cfg as (
    select a.auto_time_eligibility_enabled,
      coalesce(a.matching_settings->>'priority','balanced') priority,
      coalesce(a.matching_settings->>'levelMatch','balanced') level_match,
      coalesce(a.matching_settings->>'repeatAvoidance','moderate') repeat_avoidance,
      coalesce(a.matching_settings->>'genderPreference','none') gender_preference
    from public.activities a where a.id=target_activity_id
  ), expired as (
    select am.level,am.gender from public.activity_members am where am.id=expired_member_id and am.activity_id=target_activity_id
  ), stats as (
    select am.id,am.level,am.gender,am.source_order,
      count(m.id) filter(where m.status='completed')::integer games_played,
      coalesce(max(m.ended_at) filter(where m.status='completed'),am.checked_in_at,am.created_at) last_available_at
    from public.activity_members am join public.plans p on p.id=am.plan_id cross join cfg
    left join public.match_players mp on mp.activity_member_id=am.id
    left join public.matches m on m.id=mp.match_id and m.activity_id=target_activity_id
    where am.activity_id=target_activity_id and am.registration_status='active' and am.checkin_status='checked_in' and am.attendance_state='idle'
      and not exists(select 1 from public.preview_queue_members used where used.activity_member_id=am.id)
      and (not cfg.auto_time_eligibility_enabled or (p.start_at<=now() and p.end_at>now()))
      and not exists(
        select 1 from public.member_relationships r join public.preview_queue_members current_member
          on current_member.preview_queue_id=target_queue_id and current_member.activity_member_id<>expired_member_id
        where r.activity_id=target_activity_id and r.relationship_type='avoid_same_match'
          and least(am.id,current_member.activity_member_id)=r.member_low_id and greatest(am.id,current_member.activity_member_id)=r.member_high_id
      )
    group by am.id
  ), ranked as (
    select s.*,row_number() over(order by
      case when cfg.priority='waiting' then extract(epoch from s.last_available_at) end,
      case when cfg.priority in('games','balanced') then s.games_played end,
      s.last_available_at,s.source_order,s.id) fairness_rank
    from stats s cross join cfg
  ), scored as (
    select r.*,
      (select count(*) from public.matches hm join public.match_players candidate_player on candidate_player.match_id=hm.id and candidate_player.activity_member_id=r.id
        where hm.activity_id=target_activity_id and hm.status='completed' and exists(
          select 1 from public.match_players existing_player join public.preview_queue_members qm on qm.activity_member_id=existing_player.activity_member_id
          where existing_player.match_id=hm.id and qm.preview_queue_id=target_queue_id and qm.activity_member_id<>expired_member_id
        )) repeat_count
    from ranked r
  )
  select s.id from scored s cross join cfg cross join expired e order by
    s.fairness_rank*100
    +abs(s.level-e.level)*case cfg.level_match when 'loose' then 4 when 'strict' then 40 else 16 end
    +s.repeat_count*case cfg.repeat_avoidance when 'none' then 0 when 'strong' then 90 else 30 end
    +case when cfg.gender_preference='none' or e.gender is null or s.gender=e.gender then 0 else 80 end,
    s.id limit 1;
$$;

create or replace function public.refresh_auto_preview_expiry_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity_row public.activities%rowtype; expired_row record; replacement_id uuid; replaced_count integer:=0; blocked_count integer:=0;
begin
  select a.* into activity_row from public.activities a join public.organization_memberships om on om.organization_id=a.organization_id
  where a.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if activity_row.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status<>'in_progress' or activity_row.assign_mode<>'system_assign' or not activity_row.auto_mode_enabled then
    return jsonb_build_object('replaced_members',0,'blocked_members',0,'reason','AUTO_MODE_DISABLED');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text,12));
  for expired_row in
    select q.id queue_id,q.sort_order,qm.activity_member_id,qm.slot,qm.team
    from public.preview_queues q join public.preview_queue_members qm on qm.preview_queue_id=q.id
    join public.activity_members am on am.id=qm.activity_member_id join public.plans p on p.id=am.plan_id
    where q.activity_id=target_activity_id and activity_row.auto_time_eligibility_enabled
      and not(p.start_at<=now() and p.end_at>now()) and not qm.one_time_expired_override
    order by q.sort_order,qm.slot
  loop
    replacement_id:=public.select_auto_replacement_v1(target_activity_id,expired_row.queue_id,expired_row.activity_member_id);
    if replacement_id is null then blocked_count:=blocked_count+1;
    else
      delete from public.preview_queue_members where preview_queue_id=expired_row.queue_id and activity_member_id=expired_row.activity_member_id;
      insert into public.preview_queue_members(preview_queue_id,activity_member_id,slot,team)
      values(expired_row.queue_id,replacement_id,expired_row.slot,expired_row.team);
      replaced_count:=replaced_count+1;
    end if;
  end loop;
  return jsonb_build_object('replaced_members',replaced_count,'blocked_members',blocked_count);
end;
$$;

create or replace function public.run_auto_dispatch_cycle_v1(target_activity_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity_row public.activities%rowtype; target_queue_id uuid; target_court_id uuid; new_match_id uuid; refresh_result jsonb; fill_result jsonb;
begin
  select a.* into activity_row from public.activities a join public.organization_memberships om on om.organization_id=a.organization_id
  where a.id=target_activity_id and om.user_id=auth.uid() and om.role='owner';
  if activity_row.id is null then raise exception using errcode='42501',message='ACTIVITY_NOT_FOUND'; end if;
  if activity_row.status<>'in_progress' or activity_row.assign_mode<>'system_assign' or not activity_row.auto_mode_enabled then return jsonb_build_object('started',false,'reason','AUTO_MODE_DISABLED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_activity_id::text,11));
  refresh_result:=public.refresh_auto_preview_expiry_v1(target_activity_id);
  fill_result:=public.fill_auto_previews_v1(target_activity_id,false);
  select c.id into target_court_id from public.courts c where c.activity_id=target_activity_id and c.is_active and c.status='idle' and c.active_match_id is null order by c.sort_order limit 1;
  select q.id into target_queue_id from public.preview_queues q where q.activity_id=target_activity_id
    and (select count(*) from public.preview_queue_members qm where qm.preview_queue_id=q.id)=4
    and not exists(select 1 from public.preview_queue_members qm join public.activity_members am on am.id=qm.activity_member_id join public.plans p on p.id=am.plan_id
      where qm.preview_queue_id=q.id and (am.registration_status<>'active' or am.checkin_status<>'checked_in' or am.attendance_state<>'idle'
        or (activity_row.auto_time_eligibility_enabled and not(p.start_at<=now() and p.end_at>now()) and not qm.one_time_expired_override)))
    order by q.sort_order limit 1;
  if target_court_id is null or target_queue_id is null then return jsonb_build_object('started',false,
    'filled_queues',coalesce((fill_result->>'filled_queues')::integer,0),'replaced_members',coalesce((refresh_result->>'replaced_members')::integer,0),'blocked_members',coalesce((refresh_result->>'blocked_members')::integer,0)); end if;
  new_match_id:=public.start_match_from_preview_v1(target_activity_id,target_queue_id,target_court_id);
  update public.matches set assignment_source='auto_mode' where id=new_match_id;
  return jsonb_build_object('started',true,'match_id',new_match_id,'filled_queues',coalesce((fill_result->>'filled_queues')::integer,0),
    'replaced_members',coalesce((refresh_result->>'replaced_members')::integer,0),'blocked_members',coalesce((refresh_result->>'blocked_members')::integer,0));
end;
$$;

revoke all on function public.select_auto_replacement_v1(uuid,uuid,uuid) from public;
revoke all on function public.refresh_auto_preview_expiry_v1(uuid) from public;
